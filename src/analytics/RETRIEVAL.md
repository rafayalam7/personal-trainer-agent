# Phase 7 — Analytics Input-Retrieval Contract

Describes what source data the currently-implemented Phase 7 metrics need from
Strava's MCP and in what order — the boundary between "what we asked Strava
for" and everything downstream (normalization, eligibility, calculation, each
of which has its own contract and stays out of this document).

**Principle:** retrieve shared inputs once; retrieve metric-specific inputs
only when that metric is actually in scope; never fetch data merely because a
future metric might use it.

This is documentation, not orchestration code. MCP calls happen through
Claude Code; the existing `PostToolUse`/`PostToolUseFailure` hook
(`.claude/hooks/capture-strava.js`) is already the deterministic capture
boundary. Nothing here introduces a script, an ingestion pipeline, or a
second validation layer — see "Why documentation, not code" below.

## Inventory: what each metric actually requires

### `trailing_running_distance`
- **Activity list**: `list_activities`, **`include_tags: true`** — retrieved as
  part of the shared pattern below because `is_trainer` is useful metadata
  (provenance/coaching context, future pace or source-specific
  interpretation), **but it is no longer a correctness prerequisite for this
  metric specifically**: as of `metricVersion` 3, `is_trainer` does not gate
  this metric's eligibility at all (see `CONTRACT-trailing-running-distance.md`,
  "Trainer status is provenance, not eligibility evidence") — a capture
  without it would still produce a correct eligibility verdict from
  `distance`/`moving_time` evidence alone. `include_tags: true` stays in the
  shared retrieval call because it's cheap and still useful, not because this
  metric requires it.
- **Summary fields consumed**: `sport_type`, `start_local`, `is_trainer`
  (provenance only), `summary.distance`, `summary.moving_time`.
  (`summary.elapsed_time` is captured by `normalize()` but not currently
  consumed by this metric's eligibility or calculation — harmless surplus, not
  a requirement.)
- **Detail/stream calls**: none. Only summary-level fields are used.
- **Athlete/config MCP calls**: none at run time. `measurement_preference`
  (→ `config.displayUnit`) was a one-time human-facing fact fixed in
  `config.js`, not re-fetched per calculation.

### `trailing_running_hr_zone2_time`
- **Activity list**: the *same* `list_activities` capture as above — no
  metric-specific list call. `include_tags: true` isn't actually read by this
  metric (`eligibility-hr-zone.js` never checks `is_trainer`); it's inherited
  harmlessly because the call is shared.
- **Athlete zones**: `get_athlete_zones`, once, whole-metric-scoped (not
  per-activity). Distance never triggers this call.
- **Streams, per candidate run**: `get_activity_streams` requesting
  **exactly** `["time", "heart_rate", "moving"]`.
  - **Never** `location` — the only stream that could reveal a home address
    via run start coordinates; also simply unread by any code here.
  - **Never** `distance`/`velocity`/`altitude` — metric 1's domain, unused by
    this metric's calculation. Requesting them would pay for data nothing
    consumes.

## Retrieval completeness

**Real evidence, not a hypothetical:** every "real data" verification run
during this project's earlier milestones used `list_activities` with
`first: 30` and no date-range filter. Inspecting that exact capture file
directly: `has_next_page: true`. It was, until this milestone, silently
treated as the complete activity list — it happened to contain every activity
actually relevant to the window being tested, but nothing verified that; it
was luck, not a guarantee. That's the gap this section closes.

**The fix — ask Strava for the exact range, and verify the response proves
it's complete:**

1. Retrieve `list_activities` **once** per session, with:
   - `include_tags: true` (required by the distance metric).
   - `range_start` / `range_end` — **ISO local-time strings with no offset**
     (e.g. `"2026-09-04T21:00:00"`), the same naive-local format as
     `start_local` everywhere else in this project. Both bounds are
     **inclusive** per the tool's own description — confirmed by real
     inspection, not just documentation, matching real returned data exactly.
     Set `range_start = window_start` and `range_end = window_end` directly;
     no buffer is needed, because our own half-open window filtering
     (`window.js`, `(window_start, window_end]`) already excludes an activity
     landing exactly on `window_start` regardless of what the retrieval
     returns — over-inclusion at the retrieval boundary is harmless, silently
     corrected downstream; only *under*-inclusion would be a real risk, and
     inclusive range bounds can't cause that.
   - `first: 100` (the maximum) — minimizes the chance pagination is needed at
     all for a realistic 168h window's activity count, but does not by itself
     prove completeness (see below).
   - **Assumption, stated plainly, not hidden:** the range filter's "local
     time" is assumed to mean the same timezone as `config.timezone` — there is
     no machine-readable timezone field anywhere in these MCP responses (an
     already-existing limitation, not a new one introduced here).
2. **Pagination can still occur inside a range** — nothing about
   `range_start`/`range_end` bypasses `first`/`after`/`has_next_page`. If the
   range contains more activities than `first`, `has_next_page: true` comes
   back exactly as it would without a range filter, and the same activity-list
   response's `end_cursor` (returned at the top level in every real response
   observed — the tool's own description says `pageInfo.endCursor`, which does
   not match; trust the real shape, not the description) must be passed as
   `after` on the next call, **resending the same `range_start`/`range_end`
   and `include_tags`** (undocumented whether the cursor alone preserves the
   filter; resending is the safe assumption).
3. **How we know retrieval is complete — enforced in code, not just
   documented:** `adaptCaptures` (`adapter.js`) now requires that at least one
   of the provided list-activities captures has `has_next_page: false` in its
   parsed response. If none do, `retrievalStatus` is `"failed"` regardless of
   how many activities were actually returned — completeness is a property of
   *having reached a terminal page*, not of activity count. Verified with real
   evidence both ways: the old `first:30` capture (has_next_page:true, no
   terminal page) now correctly fails; a `range_start`/`range_end` +
   `first:100` retrieval for a real 168h window came back `has_next_page:
   false` in one call (11 real activities, genuinely complete) and is accepted.
4. **A failed or incomplete range query propagates exactly like any other
   failed retrieval** — `coverage.status: "retrieval_failed"` for whichever
   metric consumes that activity list. This is not a new status; "the
   requested data was not successfully retrieved" already covered "retrieval
   errored" and now also correctly covers "retrieval never reached a terminal
   page," which is the same underlying fact: we don't know the total.
5. **Stated limitation, not hidden:** this check assumes captures were
   gathered via correct sequential pagination — each `after` value came from
   an actual prior response's own `end_cursor`, since that's the only way to
   obtain a valid cursor at all. It cannot detect a page silently skipped in
   the middle of a sequence (page 1 and page 3 provided, page 2 never
   fetched) — that scenario requires a cursor from a response that was never
   received, which isn't possible under normal orchestration, so it isn't
   guarded against explicitly.
6. The existing capture hook persists each page to `state/.raw-capture/` — no
   change needed there.

## Shared retrieval sequence

1. Retrieve the activity list as described above ("Retrieval completeness") —
   this covers both currently-implemented metrics; neither needs a separate
   list call.
2. **If** `trailing_running_hr_zone2_time` is in scope this run, retrieve
   `get_athlete_zones` once.
3. Determine candidate running activities (sport=`Run`, start time inside the
   window) from the captured list. **Currently a manual/orchestration-level
   judgment**, not code — Claude reads the captured list and identifies which
   activity_ids are candidates. Each metric's own eligibility layer remains
   the *authoritative* filter after capture; this step is only about not
   wasting a stream retrieval on an activity nobody will end up analyzing.
4. **If** the Zone 2 metric is in scope, retrieve `get_activity_streams` for
   each candidate, `["time", "heart_rate", "moving"]` only.
5. Hand the resulting capture file paths to each metric's own CLI (see that
   metric's `CONTRACT-*.md` and `run-*.js`). This contract's responsibility
   ends here — what happens to the captures next is calculation, not retrieval.

## Boundary this contract does NOT cross

- **Retrieval** (this document) answers "what source data did we ask Strava for?"
- **Normalization** (`normalize.js`, `normalize-hr-stream.js`,
  `normalize-zone-config.js`) answers "how do we represent what Strava returned?"
- **Eligibility** (`eligibility.js`, `eligibility-hr-zone.js`) answers "can
  *this* metric legitimately use it?"
- **Metric code** answers "what is the deterministic result?"

Retrieval never decides eligibility — e.g. it does not decide "this activity
is valid for Zone 2." It only ensures the metric *has* the raw inputs
necessary to make that decision itself. If this document ever starts
containing a validity judgment, that judgment has leaked from the wrong layer.

## Why documentation, not code, for this milestone

A retrieval script would only be justified if it made a decision today's
Claude Code + MCP orchestration can't already make deterministically. Today's
sequence is 2–3 tool calls with fixed, already-documented options — not
invented per run. The one real gap (step 3, candidate-run selection) is cheap
and low-stakes: worst case, a stream gets requested for an activity that turns
out not to be a real candidate, and downstream eligibility code simply
excludes it — wasted call, not a correctness bug. That doesn't meet the bar of
"repeated real usage proving we need it." If it ever does, the justified fix is
narrow: expose `window.js`'s existing, already-tested `filterToWindow` as a
small CLI that prints candidate activity_ids from an already-captured list —
not a retrieval engine, just making an existing pure function callable outside
a test file.

## Extensibility (illustrative only — no third metric implemented here)

```text
Shared activity list (list_activities, include_tags:true, range-scoped)
├── trailing_running_distance          -- no additional retrieval
├── trailing_running_hr_zone2_time      -- + get_athlete_zones, + HR streams
└── (hypothetical) trailing_running_pace -- + distance/velocity streams only,
                                             for candidates already identified
                                             in step 3 above; no new list call,
                                             no change to this document's
                                             shared steps 1-2 or 4
```

A new metric adds a new bullet under "Inventory" and, if it needs a stream
call, a new conditional sub-step under "Shared retrieval sequence" — it does
not restructure steps 1–2 (the shared list) or the boundary section above.
