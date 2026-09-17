# Phase 7 — Second Vertical Slice Contract: `trailing_running_hr_zone2_time`

Locked before implementation, then revised once during review (both rounds
folded in below — this is the final contract, not a diff). One metric only —
see `CLAUDE.md`'s Phase 7 scope guardrail. Do not extend to time-in-every-zone,
Zone 2 percentage, average HR, HR drift, aerobic efficiency, pace-to-HR
analysis, training load, readiness, HR recovery, cycling HR zones, or max-HR
estimation without a separate design discussion.

**Why this metric, architecturally:** `trailing_running_distance` only ever
touched activity-level summary fields. This one deliberately exercises what
that one didn't: stream-level (time-series) data, a second live MCP
configuration source (`get_athlete_zones`), time-weighted (non-summable)
aggregation, and the large-response capture path as normal operation, not an
accident. It also proves metric-specific eligibility concretely: activity
`90000000001` (a treadmill run, `is_trainer:true`, `distance:0` — **invalid**
for `trailing_running_distance`) has `has_heartrate:true` and a real HR
stream — **eligible** here.

## Window & sport inclusion — reused verbatim, not reinvented

Identical to `trailing_running_distance`: trailing 168 hours, half-open
`(window_start, window_end]`, `window_end` always explicit, membership by
`start_at`, `internal_activity_type === "run"`. Both metrics import the same
`window.js` (`filterToWindow`, `dedupeByActivityId`) — this is enforced in
code, not just documentation, specifically so there is never a second meaning
of "168 hours."

## Canonical / display unit

Internal: **seconds**. Display: **minutes**, via a separate `secondsToMinutes`
helper (`display.js`) — never inside the metric calculation itself, same
separation as meters→miles.

## Zone-source/config contract

Zone 2 = `heart_rate_zones[1]` (`config.heartRateZoneTime.zone2Index = 1`) —
Strava's own ascending zone-array convention, confirmed against a real
`get_athlete_zones` response. Never derived from age/max-HR formulas. Captured
by the same `PostToolUse` hook as everything else, with its own
`capture_ref`/`captured_at` in the result's provenance, independent of activity
captures.

- **Zone 2 well-formed** → proceed.
- **Zone 2 absent or malformed** (fewer than 2 zones, non-numeric `min`, or
  `min ≥ max`) → `coverage.status: "config_invalid"` (see below — deliberately
  *not* `retrieval_failed`).
- **Zone retrieval itself fails** (`PostToolUseFailure` on `get_athlete_zones`)
  → `coverage.status: "retrieval_failed"`.
- **Zone config changes between two runs** → each run captures its own config
  independently; a different config legitimately produces a different,
  traceable result.

## Zone-config failure semantics (revised)

Five `coverage.status` values total: `complete | partial | empty |
retrieval_failed | config_invalid`. `retrieval_failed` means, truthfully, only
"a retrieval attempt itself failed" — activity list, a stream, or the zone
lookup as a tool call. `config_invalid` means retrieval succeeded but the
configuration doesn't support this metric. This is the smallest addition that
avoids a semantic lie (collapsing both into `retrieval_failed` would tell a
downstream consumer "couldn't reach Strava" when the real actionable fact is
"go check your Strava zone settings") — not vocabulary growth for its own sake.

## Zone boundary semantics

**Both bounds inclusive** (`min ≤ hr ≤ max`) — unlike the time-window's
half-open convention. Justified: Strava constructs zones as contiguous,
non-overlapping *integer* ranges (131|132, 163|164, ...) and every HR value
observed in real streams is a whole number, so there's no shared boundary
value to disambiguate. The top zone (`{min:196}`, no `max`) is open-ended
above. Pinned exactly by fixtures: HR=131→Zone 1, HR=132→Zone 2 (lower edge),
HR=163→Zone 2 (upper edge), HR=164→Zone 3.

## Stream normalization — preserves alignment (revised)

`normalizeHeartRateStream` produces `samples: [{t, hr, moving}, ...]`,
index-aligned with the raw `time`/`heart_rate`/`moving` arrays, length for
length. `hr`/`moving` are preserved **exactly as returned**, including
explicit `null` — never filtered, never collapsed, never coerced. Also
records `heart_rate_stream_present`/`moving_stream_present` (was the key
present in the response at all — an activity-level, structural fact) *separately*
from what individual sample values contain (an interval-level fact). Collapsing
these would let "missing_hr" silently expand into wrong-duration intervals.

**Architecture rule:** normalization preserves observations. Eligibility and
interval attribution judge whether those observations can support the metric —
never the reverse.

## Eligibility (activity-level, independent of `trailing_running_distance`)

A cheap **structural** gate only — it does not judge individual samples:

- `internal_activity_type !== "run"` → `unsupported`.
- HR stream retrieval failed for this specific activity (a `PostToolUseFailure`
  on that activity's `get_activity_streams` call) → `retrieval_failed` — distinct
  from never having HR data at all. (Per-activity, since stream captures are
  per-activity, unlike the whole-batch activity-list capture — one failed
  stream never taints the other activities' results.)
- `heart_rate_stream_present === false` → `missing`.
- Fewer than 2 samples → `invalid` ("insufficient to construct any interval").
- No HR plausibility floor added (e.g., rejecting implausible bpm values) — no
  real corrupted HR record justifies one, unlike the distance metric's
  `moving_time` floor. Do not add one without the same bar: a real bad record,
  not a hypothetical.

## Interval attribution (revised — replaces the original gap-only design)

Forward attribution: sample `i` governs `[time[i], time[i+1])`. The last
sample contributes zero (no next instant to bound it) — self-consistent within
the stream, never borrowed from a summary field (the treadmill activity's own
summary `elapsed_time:2` directly contradicted its lap data's `elapsed_time:60`
in real data — summary duration fields are not trustworthy enough to bound
anything here).

Every interval resolves to exactly one bucket, in this precedence order:

1. `moving[i]` is `null`/missing → **`unrepresented_seconds`**, reason
   `missing_moving_seconds`.
2. `moving[i] === false` → **`non_moving_seconds`** (HR validity irrelevant).
3. `moving[i] === true`, `hr[i]` is `null`/missing → **`unrepresented_seconds`**,
   reason `missing_hr_seconds`.
4. `moving[i] === true`, `hr[i]` present but not a finite number →
   **`unrepresented_seconds`**, reason `invalid_hr_seconds`.
5. `moving[i] === true`, `hr[i]` finite:
   - gap `≤ maxGapSeconds` → full duration to **`zone2_seconds`** or
     **`other_zone_seconds`**.
   - gap `> maxGapSeconds` → `maxGapSeconds` to the zone bucket, excess to
     **`unrepresented_seconds`**, reason `large_gap_seconds`.

### Invariant (per included run)

```
zone2_seconds + other_zone_seconds + non_moving_seconds + unrepresented_seconds
  = total_represented_seconds  (= time[last] - time[0])
```
where `unrepresented_seconds = missing_moving_seconds + missing_hr_seconds +
invalid_hr_seconds + large_gap_seconds`. Directly tested for every fixture.

## Gap threshold — provisional, not physiological

`config.heartRateZoneTime.maxGapSeconds = 30`. Versioned config. **Provisional
— no real gapped HR stream was found in this athlete's history to validate it
against** (every real stream inspected was either densely 1Hz-sampled with a
max `moving:false` streak of 4 seconds, or too short to show a gap at all).
Not a physiological claim about sensor dropout windows. Subject to revision
the moment real evidence appears — same discipline as the distance metric's
`minMovingTimeSeconds`, which two real corrupted records did justify. Do not
add further thresholds without the same bar.

## Coverage semantics

Per run: the four buckets above, always summing to that run's
`total_represented_seconds`. Whole-metric: `recorded_runs_considered`,
`runs_with_usable_hr`, `runs_excluded` (fully excluded, with reason in
`exclusions[]`), plus a **separate** `partial_coverage[]` list for runs that
*were* included but had nonzero `unrepresented_seconds` — these contributed
real Zone 2 time and must never be conflated with fully-excluded runs, nor
reported as if 100% of their duration was analyzed.

`coverage.status`: `empty` (0 runs in window), `complete` (≥1 run, none
excluded, none partially unrepresented), `partial` (≥1 excluded OR ≥1 included
run has any `unrepresented_seconds`), `retrieval_failed`, `config_invalid`
(both override the others).

## Required normalized-representation additions

`normalize()` (summary-level, `trailing_running_distance`'s) is reused
**unchanged** — `is_trainer`/`distance` stay irrelevant here, which is the
point. Two new, **separate** shapes (summary vs. detailed streams stay
distinguishable):
- `normalizeHeartRateStream` → `{ source_activity_id, samples, heart_rate_stream_present, moving_stream_present, capture_ref, captured_at }`.
- `normalizeZoneConfig` → `{ zone2, valid, source, all_zones_raw, capture_ref, captured_at }`.

## Capture-boundary implications

No hook changes needed — `.claude/hooks/capture-strava.js`'s existing matcher
already covers `get_activity_streams` and `get_athlete_zones`; both were
re-verified with full fidelity on real captures (index-aligned arrays, correct
length, zero truncation once the side-file redirect is followed for the large
one). Practice adopted: **request only `["time", "heart_rate", "moving"]`** —
never `location`, and no `distance`/`velocity`/`altitude` (metric 1's domain).
Confirmed no location data exists in any current capture.

## Structured result

```json
{
  "metric": "trailing_running_hr_zone2_time",
  "metric_version": 1,
  "window": { "start_epoch_ms": 0, "end_epoch_ms": 0, "hours": 168 },
  "zone_config": { "zone2": { "min": 132, "max": 163 }, "source": "MaxHeartRate", "capture_ref": "...", "captured_at": "..." },
  "result": { "zone2_seconds": 0, "unit": "seconds" },
  "coverage": {
    "status": "complete",
    "recorded_runs_considered": 0,
    "runs_with_usable_hr": 0,
    "runs_excluded": 0,
    "total_represented_seconds": 0
  },
  "exclusions": [{ "activity_id": "...", "state": "missing", "reason": "..." }],
  "partial_coverage": [{ "activity_id": "...", "unrepresented_seconds": 0, "unrepresented_breakdown": { "missing_moving_seconds": 0, "missing_hr_seconds": 0, "invalid_hr_seconds": 0, "large_gap_seconds": 0 } }],
  "provenance": { "source": "strava", "schema_version": 2, "computed_at": "..." }
}
```

## Real ambiguities remaining (honest, not resolved by inventing an answer)

- **Still open — no real gapped HR stream (>`maxGapSeconds`) was found**, even
  after backtesting 3 historical windows including a known-corrupted activity.
  The largest real gap found (see "Backtest evidence" below) was 9 seconds,
  well under the 30s threshold. `maxGapSeconds` remains reasoned, not
  evidence-validated — per its own provisional status, this is not a reason to
  change it.
- No real activity was found with null/invalid entries *inside* an otherwise-
  present HR array — the null/invalid handling is defensively specified but
  unverified against real data (the null-alignment fixture is synthetic).
- Whether Strava ever returns non-integer HR is unconfirmed (all real values
  seen are integers, which is what makes the closed-closed boundary convention
  unambiguous).

## Backtest evidence (3 historical windows, see Phase 7 closing review)

- **Real irregular spacing, under the cap**: activity `90000000004`'s stream
  has a real 9-second gap (`time` jumps 1196→1205) — handled seamlessly, no
  `large_gap_seconds` triggered, confirming the synthetic irregular-spacing
  test's behavior against genuine device data.
- **New real finding, not anticipated in the original contract**: activity
  `90000000003` (the same GPS-corrupted run that justified
  `minMovingTimeSeconds` in the distance metric) has a `moving` stream that is
  `false` for nearly its entire ~30-minute duration, despite HR climbing
  plausibly to 210 bpm. Under this metric's design, that correctly routes
  almost all of its represented time to `non_moving_seconds`, not
  `zone2`/`other_zone` — a conservative, non-inflating outcome, exactly as
  designed, but a real limitation worth naming: this metric's accuracy is only
  as good as the `moving` stream's own accuracy, and this is a real example of
  that stream being unreliable on a device/GPS-failure activity. Not treated
  as a defect — see the Phase 7 closing review's correctness/robustness/future
  classification.
- A real treadmill run (`90000000001`) contributed 0 zone2 seconds (HR 178-180,
  above Zone 2's 163 max) — confirms the multi-metric-eligibility proof holds
  with a second real example, not just the one from initial development.
