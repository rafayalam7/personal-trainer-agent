# Weekly Review Workflow (Phase 6 V1)

## Purpose
Step back from single sessions to a `review_period` — normally the trailing 7 days —
and turn the lower-level coaching interactions (Daily Check-Ins, Post-Workout
Reviews, carry-forward outcomes) into longer-term learning: what happened, whether
training aligned with intent, what patterns matter, what was learned, and what
should be prioritized in the rolling sequence going forward.

**This is a cadence for observation, not a training-cycle boundary.** The rolling
schedule (`profile/schedule.md`) continues continuously underneath it. Completing a
Weekly Review must never reset the rotation, restart the sequence on a fixed weekday,
mark missed sessions as permanently abandoned, or introduce a calendar-week boundary
into the training logic. It places a 7-day observation window over part of an
ongoing sequence — nothing more.

## Inputs
- `profile/athlete.md`, `profile/goals.md`, `profile/schedule.md` — durable context,
  priority hierarchy, rotation template/policy.
- `state/checkins/*.md` falling inside the review period.
- `state/reviews/*.md` falling inside the review period.
- `state/carry-forward.md` — both active items (current state) and recently
  resolved/expired history (what got learned).
- Strava MCP activities for the period, validated per CLAUDE.md's data-quality rule —
  used only as individual session-level facts, never aggregated.
- The most recent prior `state/weekly-reviews/*.md`, if one exists — for continuity
  (did last time's priorities actually hold up?).
- **Phase 7 deterministic metrics** (`trailing_running_distance`,
  `trailing_running_hr_zone2_time`) — structured results, not numbers Claude
  computes. See "Deterministic Analytics Input" below.

## Deterministic Analytics Input (Phase 7)
Shared discipline for every metric cited here, regardless of which one: run its
CLI, read the printed JSON, never recompute/round/"fill in" any field by hand.
**Never derive a new aggregate number from a result's own fields** — e.g. a
Zone 2 percentage from `zone2_seconds`/`total_represented_seconds`, an average
per-run duration, a ratio against distance. Those would be new deterministic
metrics in their own right if ever wanted — not something Claude computes
inline here. Each metric's exact calculation semantics live in its own
`CONTRACT-*.md` — never duplicated in this workflow doc.

**A metric's window is not the same thing as this workflow's `review_period`,**
even though both default to roughly 7 days. Each metric's window is an exact
trailing-168-hour span ending at an explicit timestamp; `review_period` is this
workflow's own observation window, which can widen to close a gap or be pointed
elsewhere manually (see Review-Period Selection below) and is not hour-exact.
When citing any metric, state its own window explicitly (e.g. "in the metric's
trailing 168-hour window") rather than assuming it matches `period_start`/
`period_end` for this review, and never shorthand it as "this week's ___"
unless the two windows actually align.

**What to retrieve and how — for every metric below — is centralized in
`src/analytics/RETRIEVAL.md`, not restated here.** That document is the single
source of truth for which MCP calls happen, with which options, in what order,
and why (shared vs. metric-specific, privacy-minimal stream requests). This
section only covers what's genuinely Weekly-Review-specific: how to invoke
each metric's CLI against whatever was retrieved, and how to phrase its result.

### `trailing_running_distance`
```
node src/analytics/run-trailing-running-distance.js <windowEndIso> <captureFile...>
```
against the activity-list capture from `RETRIEVAL.md`'s shared step 1 (see
`src/analytics/CONTRACT-trailing-running-distance.md` for calculation semantics).

**Required interpretation language**, driven by `coverage.status`:
- `complete` — state the value plainly: *"The captured period contains 6.5 miles of
  validated running distance."*
- `partial` — the qualification travels with the number, always: *"Validated
  distance totals X miles across N of M recorded runs; **`<K other runs>`** were
  excluded because **`<their exclusion reasons>`**."* Never state a partial subtotal
  as if it were the whole picture.
- `empty` — state plainly that no recorded running activity fell in the window; this
  is a fact, not an absence of information.
- `retrieval_failed` — state that the metric could not be computed this time (data
  retrieval failed) — never substitute a guess, a prior period's value, or silence.

Claude must not: infer the missing mileage for excluded runs, silently upgrade
`partial` to `complete` in the prose, recompute or spot-check the total itself, or
replace the structured `exclusions` list with its own guess at why something was
excluded — read `exclusions[].reason` verbatim (paraphrase for readability, don't
invent a different reason).

### `trailing_running_hr_zone2_time`
```
node src/analytics/run-trailing-running-hr-zone2-time.js <windowEndIso> <activityListCaptureFile> <zoneConfigCaptureFile> <streamCaptureFile...>
```
against the activity-list, zone-config, and HR-stream captures from
`RETRIEVAL.md`'s shared and metric-specific steps (see
`src/analytics/CONTRACT-hr-zone2-time.md` for calculation semantics). Read the
printed JSON — never recompute.

**Required interpretation language**, driven by `coverage.status`:
- `complete` — *"Validated running HR data shows X minutes in your configured
  Strava Zone 2 during the metric's trailing-168-hour window."*
- `partial` — the qualification travels with the number, always: *"Validated HR
  streams show X minutes in Zone 2 across the analyzable runs. HR data was
  unavailable or unusable for one or more recorded runs, so this is a partial
  result rather than total Zone 2 time for all running."* Name the excluded
  run(s) and their reason (from `exclusions[].reason`, paraphrased, not
  invented) when useful — e.g. "no HR data was recorded for one run" — but
  **never** state or imply the excluded run contributed zero Zone 2 time; the
  honest fact is that it's unmeasured, not zero.
- `empty` — state plainly that no recorded running activity fell in the
  window. **Never** rephrase this as "no aerobic exercise" or anything about
  overall training — the metric only describes recorded running activity.
- `retrieval_failed` — state that the metric could not be calculated because
  required Strava data could not be retrieved. **Never** imply zero Zone 2 time.
- `config_invalid` — state that the athlete's Strava HR-zone configuration was
  retrieved but doesn't support this metric (e.g. Zone 2 missing/malformed).
  **Never** describe this as an outage (it isn't a retrieval failure) or as
  zero Zone 2 time (it's a configuration problem, not a measurement).

**Per-run exclusions:** a run excluded with `state: "missing"` (structured
Strava data reports no HR — `has_heartrate: false`) means HR data was
unavailable for this metric, never that the athlete spent zero time in Zone 2.
**Free-text activity descriptions that mention HR numbers must never override
the structured availability signal** — if `has_heartrate` is false, treat HR as
unavailable regardless of what a description says. If manually-reported HR
should ever become a separate eligible source, that needs its own provenance
design later — not an ad hoc override here.

**No new arithmetic, restated:** Claude may interpret the provided facts
qualitatively (e.g. "a meaningful share of this run's HR data" is fine; "42% of
this run" computed from the two seconds fields is not) but must not independently
calculate a Zone 2 percentage, an average duration, a per-run fraction, or a
ratio against distance from this result's fields.

**Don't over-interpret:** this metric answers exactly one narrow question — how
much analyzable running time in the trailing window was spent in configured
Zone 2. It does not by itself say whether that was "enough," whether aerobic
fitness improved, whether intensity distribution was optimal, or whether more
Zone 2 should be prescribed. Any such judgment must combine this metric with
actual sessions, goals, current training phase, recovery context, and
Post-Workout Reviews — never treat one metric as a standalone training doctrine.

## Review-Period Selection
`review_period`, not "week" — this language is deliberate throughout. Default:
- `period_start = review_date - 6 days`, `period_end = review_date` (trailing 7
  days), computed fresh each time. Never anchored to a fixed weekday.
- If there's an uncovered gap since the last Weekly Review (e.g. the last one was 10
  days ago), widen the window to close the gap rather than silently skipping days —
  a judgment call, same style as the rolling-schedule spacing rules, not a rigid
  formula.
- Can be manually pointed elsewhere ("review since my last long run," "look at the
  last 10 days") — the window is a lens, not an accounting period.

## Reasoning Flow
```
Strava activities (period, validated)  ─┐
Check-ins (period)                     ─┤
Post-Workout Reviews (period)          ─┼─► A. Reconstruct What Happened
Carry-forward (active + resolved hist) ─┘     (session-level timeline — no
                                                aggregate math)

Profile: Goals/Schedule/Restrictions  ──┐
Prior Weekly Review (if any)           ─┼─► B. Alignment Assessment
                                              (rolling intent vs. actual, qualitative
                                               — NOT calendar-plan adherence)
                                                    │
                                                    ▼
                                        C. Pattern Recognition
                                        (stacking, displacement, recovery placement,
                                         recurring pain/fatigue, substitutions,
                                         adherence to prior guidance)
                                                    │
                                                    ▼
                                        D. Synthesis — What We Learned
                                        (carry-forward outcomes this period, whether
                                         past coaching calls held up, durability
                                         narrative)
                                                    │
                                                    ▼
                                        E. Forward Priorities
                                        (narrative: priorities / cautions / protect /
                                         delay-ok / recovery considerations)
                                                    │
                                                    ▼
                                        F. Promote to Carry-Forward
                                        (only items concrete enough to actively shape
                                         the very next session — same bar Phase 5
                                         uses for Post-Workout Review)
```

## Numeric Scope — V1 vs. Phase 7 boundary
Strict application of CLAUDE.md's "code calculates, Claude reasons" rule. Phase 7
(deterministic analytics) doesn't exist yet, so this workflow must not have Claude
manually compute cross-session metrics: weekly mileage, average pace, week-over-week
% change, rolling averages, HR-zone distribution, long-run share of volume, training
load scores, aggregate intensity percentages. None of that belongs here yet.

**The rule:** session-level facts → this workflow can use them. Cross-session
arithmetic (sums, averages, % change, zone distribution, load scores) → Phase 7.

Edge cases, resolved for V1:
1. **Counting discrete events** (e.g. "leg day happened twice," `sessions_in_period:
   5`) is allowed — it's enumeration, not a derived metric. No averages, no rates.
2. **Comparing two specific sessions qualitatively** is allowed ("today's ride ran
   hotter than last Tuesday's comparable ride," using two already-Strava-computed,
   session-level numbers). Computing an actual percentage difference between them is
   not — that's a derived metric even with just two data points.
3. **Strava-native period rollups** — if Strava ever exposes a pre-computed
   period-level total, it may be cited after the usual validation. As of V1 the
   available Strava MCP tools (`list_activities`, `get_activity_performance`,
   `get_activity_streams`) all appear activity-scoped, so this is currently moot.
4. **Trend language without numbers** — "sessions have felt harder toward the end of
   the period" is exactly the qualitative pattern recognition this workflow exists
   for. The distinction is: cross-session *arithmetic* is off-limits; cross-session
   *narrative pattern recognition* is the point of Phase 6.
5. **Weekly-pattern carry-forward items may resolve slowly.** Something like "hard
   sessions stacked too closely" is tested across several sessions, not one — it
   still uses `resolution_requires: post_workout_review` (no schema growth), but its
   resolution may only become visible at the *next* Weekly Review's synthesis rather
   than the very next workout. Worth expecting, not a special case to design around.
6. **Session purpose vs. session activity.** When describing what happened to a
   template slot, use `profile/schedule.md`'s retained / replaced / dropped
   vocabulary — a replacement that serves the same purpose (e.g. a long walk for a
   long run under a knee flag) is not the same as a drop. A purpose that keeps
   coming up dropped or replaced by something unrelated is exactly the "repeatedly
   displaced" pattern described above — evidence the template itself may need
   reconsideration, not a debt to keep rescheduling. No fixed count triggers this.

**Designed for Phase 7 compatibility:** when deterministic analytics exist, they
slot in as another input to step A (alongside Strava activities, check-ins, and
reviews) without changing the output schema, storage format, or how carry-forward
items are created/consumed. Nothing here needs to be redesigned when that happens.

## Output Schema
```
---
review_date: 2026-09-05
period_start: 2026-08-30
period_end: 2026-09-05
sessions_in_period: <count>
carry_forward_referenced: [<id>, ...]
carry_forward_created: [<id>, ...] | none
---

What Happened: <narrative timeline of the period's sessions, session-level facts
only>

Alignment with Intent: <how actual training compared to rolling schedule intent,
goals priority hierarchy, and active restrictions — qualitative, not calendar-plan
adherence>

Patterns Observed:
- <e.g. "leg day was displaced twice, cardio filled both slots instead">
- <e.g. "two hard efforts landed on consecutive days without an easy session
  between">

What We Learned: <synthesis from carry-forward outcomes, whether prior guidance held
up, what this says about the current durability trend>

Forward Priorities:
  priorities: [...]
  cautions: [...]
  protect: [...]              # session types worth protecting from displacement
  delay_ok: [...]             # session types okay to delay if needed
  recovery_considerations: [...]
  unresolved_concerns: [...]  # active carry-forward items still open at period_end
```

## Persistence
One file per performed review, at `state/weekly-reviews/YYYY-MM-DD.md`, filename =
`review_date` (when the review was performed, not a week number). `period_start` /
`period_end` in the frontmatter make the observation window unambiguous regardless of
cadence. This avoids ISO week-numbering ambiguity and correctly reflects that reviews
won't always land on the same day.

## Carry-Forward Interaction
- **Reading:** same as Daily Check-In — read `state/carry-forward.md`'s active items,
  plus scan for items that changed status (resolved/escalated/expired) during the
  review period. "What We Learned" reports on outcomes: what resolved and how, what's
  still open and why (respecting each item's `resolution_requires`), what escalated,
  what passively expired unresolved. A recurring pattern of items expiring unresolved
  is itself worth flagging. Every item still `active` at `period_end` appears in
  `unresolved_concerns`.
- **Writing:** this workflow reports on carry-forward items; it does not resolve
  them — that stays Daily Check-In's / Post-Workout Review's job per the Phase 5
  design. It may *create* new items, but narrowly: only for concerns visible at the
  weekly altitude that no single check-in or review would have caught alone (the
  canonical case: a session type repeatedly displaced across the period, where each
  individual day's substitution looked reasonable in isolation). These use the
  identical `state/carry-forward.md` schema from Phase 5 — same fields, same
  `resolution_requires: checkin | post_workout_review` gate, `source_review` pointing
  at the weekly-review file instead of a post-workout one. No schema growth. The same
  creation bar applies: not every Forward Priority becomes a tracked item, only ones
  concrete enough to actively shape the next session.

## Feeding Future Daily Check-Ins
One channel, not two: `state/carry-forward.md`. Any item promoted per the rule above
lands there, and `coaching/daily-checkin.md`'s existing Read Pattern (step 6) already
reads active carry-forward items every time — no change needed there. The rest of
the Forward Priorities narrative (softer observations that don't clear the
carry-forward bar) lives only in the weekly-review file itself, mainly for human
continuity and for the *next* Weekly Review to reference against — it is not
force-fed into every daily check-in as a second parallel context source.

## V1 Scope
**Does:** rolling 7-day (or gap-adjusted) observation window, narrative synthesis
across check-ins/reviews/Strava/carry-forward, qualitative pattern recognition,
carry-forward outcome reporting, narrow carry-forward creation for weekly-altitude
patterns, one Markdown file per performed review.

**Does not (yet):** any cross-session arithmetic (mileage totals, averages, % change,
zone distribution, load scores — Phase 7's job), calendar-week training boundaries,
automatic/scheduled triggering, SQLite or any database, strength progression
programming (Phase 9).
