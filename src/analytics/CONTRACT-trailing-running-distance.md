# Phase 7 — First Vertical Slice Contract: `trailing_running_distance`

Locked before implementation (Pre-Phase-7 process). One metric only — see
`CLAUDE.md`'s Phase 7 scope guardrail. Do not extend this contract to a second
metric without a separate design discussion.

## Metric semantics

- **Window:** exact trailing 168 hours. `window_end` is always an explicit
  timestamp passed in — never read from "now" inside the pure metric function.
  `window_start = window_end - 168h`.
- **Membership basis:** activity `start_at` (local start time), not end time, not
  any instant during the activity.
- **No calendar-week semantics.** This reuses Weekly Review's own `review_period`
  framing (a window, not a training-cycle boundary) rather than inventing a
  second concept.
- **No Claude arithmetic.** The metric function is pure code; Claude only calls it
  and interprets the structured result.

## Window boundary convention

**Half-open: `(window_start, window_end]`** — `window_start` is **excluded**,
`window_end` is **included**. An activity starting exactly at `window_start` is
not counted; one starting exactly at `window_end` is.

(Revised from an earlier both-inclusive design.) Reason: this metric will
eventually be called repeatedly with adjacent windows (e.g. this week's trailing
168h, then next week's) for comparison. With a half-open convention, consecutive
windows tile exactly — the instant that closes one window is the same instant
that would open the next, and it belongs to exactly one of them, never both.
Both-inclusive boundaries would double-count an activity landing precisely on a
shared edge once windows are compared against each other; open-at-both-ends
would risk *losing* such an activity from every window. Half-open,
closed-on-the-recent-end, is the standard choice for tiling trailing periods and
is the one that survives comparison across periods, not just within one.

## Timezone

Re-confirmed directly against real captured MCP payloads (not just
`get_athlete_profile`): **no absolute-UTC timestamp and no machine-readable
timezone field exists anywhere** in `list_activities`, `get_activity_performance`,
or `get_activity_streams` responses — only the naive local `start_local` string.
So there is nothing to prefer over local-time interpretation; the MCP simply
doesn't expose a UTC source of truth for activity start times.

**Timezone is therefore explicit local configuration — `config.timezone`, an
IANA zone string (`"America/Chicago"`) — never derived from any MCP field, never
looked up from a geo/timezone service, never inferred from `athlete.location`.**
It lives in `src/analytics/config.js` alongside every other named, versioned
Phase 7 constant, for the same reason those live there: a human decided this
value once, explicitly, and the code never re-derives or guesses it.

Resolution from a naive local string to an absolute instant (`normalize.js`,
`resolveLocal`) uses Node's built-in `Intl.DateTimeFormat` (full ICU, ships with
Node by default — no added dependency, no external service) to find the actual
UTC offset for that IANA zone at that instant. This is DST-aware: verified
against the real 2026 US transition dates (`America/Chicago` resolves to
`-06:00` before 2026-03-08 and `-05:00` after; `-05:00` before 2026-11-01 and
`-06:00` after). This replaces an earlier fixed-offset design that would have
been silently wrong for roughly half of every year.

**Known, accepted V1 limitation:** the one local hour that never occurs (spring
forward) or occurs twice (fall back) is not specially disambiguated — a logged
workout would have to fall in the 2-3am local window on one specific day per
year for this to matter. Athlete travel across timezones is also out of scope —
`config.timezone` is a single, permanent value, not a per-activity one.

## Distance source & precedence (checked in this exact order)

1. `internal_activity_type !== "run"` → `unsupported`. Classification is an exact
   sport_type match via `config.sportClassification` (`Run` only maps to `run` in
   V1 — `TrailRun`/`VirtualRun`/etc. are `other`, not guessed at).
2. `summary.distance` absent → `missing`. Never coerced to zero.
3. `summary.moving_time` absent → `invalid` (can't assess plausibility).
4. `moving_time_s < config.trailingRunningDistance.minMovingTimeSeconds` (60s) →
   `invalid`. Real example found during contract design: an **outdoor**,
   GPS-tagged run (`is_trainer: false`) with `distance: 41.9m` and
   `moving_time: 8s` for what the athlete's own description called a 2.85-mile
   run — a GPS failure `is_trainer` alone doesn't catch.

   **This threshold is a metric-eligibility heuristic, not a universal
   definition of a valid run.** It is named and versioned config
   (`minMovingTimeSeconds`, under `trailingRunningDistance.metricVersion`) —
   deliberate, minimal, and justified by the real corrupted record above, not a
   speed-plausibility heuristic requiring free-text trust. It may be revised if
   future real data shows it wrongly excluding a genuinely short valid run, or
   admitting a broken one — that revision would bump `metricVersion` so it's
   visible in every result's provenance, never a silent behavior change. Do not
   add further plausibility thresholds without the same bar: a real corrupted
   record, not a hypothetical one.
5. `distance.value_m === 0` on a run that passed all the above → `invalid`, not
   `legitimate_zero`. A real "Run" activity inherently covers nonzero distance;
   a recorded zero signals a data problem. (Contrast: `elevation_gain: 0` on a
   flat course, or `distance: 0` on a lift, are genuine legitimate zeros —
   irrelevant to this metric either way.)

Only `summary.distance` is used — never the distance *stream*. An activity can
have a perfectly valid summary distance while its distance stream is unusable
(or vice versa); this metric only cares about the former. That's the concrete
proof that eligibility is metric-specific, not activity-specific.

## Trainer status is provenance, not eligibility evidence (revised — v2→v3)

**`is_trainer` (treadmill/indoor vs. outdoor) is no longer part of this
metric's eligibility check at all.** It was, through v2: `is_trainer === null`
→ `invalid` (unknown status), and `is_trainer === true` → `invalid`
(blanket-excluded), justified by a real broken record —
`is_trainer: true, distance: 0, moving_time: 2` (activity `90000000001`,
2026-08-30) — the athlete's treadmill logging at the time.

**That justification stopped holding once a second, differently-sourced
treadmill record arrived.** A real Technogym Skillrun sync (activity
`90000000002`, 2026-09-16) is also `is_trainer: true`, but structurally sound:
nonzero `distance`, `moving_time === elapsed_time` (no idle gap), plausible
`avg_speed`/`avg_cadence`/`avg_watts`. `is_trainer` was never actually evidence
about distance quality — it was a proxy that happened to correlate with one
broken record from one treadmill logging method. A second treadmill source
broke the correlation. Outdoor sources can be just as broken (see the GPS
-failure example under step 4 above) — the metric never treated `is_trainer:
false` as a validity guarantee either, so treating `is_trainer: true` as a
validity *disqualifier* was the same category error in the other direction.

**The fix removes the label check entirely rather than special-casing the new
source.** `is_trainer === null` is treated the same as any other run now — it
falls through to the distance/`moving_time` checks like everything else,
because not knowing the label was never itself evidence that the *distance*
data is bad. The existing `moving_time ≥ 60s` + nonzero-`distance` checks
(steps 3–5 above) are sufficient on their own to distinguish every known real
good and bad record, treadmill or outdoor — verified directly: the old broken
treadmill run still fails on `moving_time < 60s`, the new Technogym run passes
every check, the real GPS-failure outdoor run still fails on `moving_time <
60s`, and the real valid outdoor run still passes. No new threshold was added.

**`is_trainer` is preserved on the normalized activity as provenance/context**
(source/debugging context, coaching explanations, future pace or
source-specific interpretation) — it simply no longer gates *this* metric's
eligibility. `include_tags: true` remains part of the shared retrieval pattern
because that metadata is still useful, but it is no longer a correctness
prerequisite for `trailing_running_distance` specifically — see `RETRIEVAL.md`.

## Duplicates & re-captures

Deduplicate by `source_activity_id` (opaque string — never parsed as a number).
If the same id appears in two captures with different values (an edit,
re-capture, or overlapping pagination), **the most recently *captured* version
wins**, by `captured_at`, never by array position — this must hold regardless of
input order.

## Unit

Internal: **meters** (Strava's native unit — no conversion before validity is
known). Display: **miles** (`get_athlete_profile.measurement_preference:
"Imperial"`, confirmed) — converted only at the Weekly Review interpretation
step, never inside the metric function.

## Result states

- **complete** — retrieval succeeded, ≥1 run considered, none excluded.
- **partial** — retrieval succeeded, ≥1 run considered, ≥1 excluded (even if 0
  are included — still `partial`, not `empty`, because there *were* recorded
  runs, just none eligible).
- **empty** — retrieval succeeded, 0 runs considered in the window at all.
- **retrieval_failed** — the underlying capture(s) failed or were unrecognized;
  we cannot know the total. Overrides every other status.

A partial subtotal is never presented as complete — `coverage.status` and
`exclusions` travel with the number everywhere it's used.

## Versioning

`schemaVersion` bumped 1→2: the normalized activity's timezone fields changed
shape (`interpreted_utc_offset` → `interpreted_timezone` +
`resolved_utc_offset_minutes`) when the fixed-offset design was replaced.
`trailingRunningDistance.metricVersion` bumped 1→2: the window boundary
convention changed from both-inclusive to half-open, which changes which
boundary-adjacent activities a result includes. Bumped again 2→3: `is_trainer`
removed as an eligibility gate (see "Trainer status is provenance, not
eligibility evidence" above) — a treadmill run's distance that was `invalid`
under version 2 may be `valid` under version 3, purely because the gate no
longer exists, not because its distance/`moving_time` evidence changed.
Results computed under different metric versions are not directly comparable
— this is exactly why the version is named and carried in every result's
`provenance`.
