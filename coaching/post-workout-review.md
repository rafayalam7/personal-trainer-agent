# Post-Workout Review Workflow (Phase 5 V1)

## Purpose
Close the loop after a completed workout: compare it against what was recommended
(if anything), capture subjective post-workout signals, and — only when the concern
actually needs it — create carry-forward state for the next Daily Check-In. This is
not a training-log habit for every activity; only review-worthy sessions get a full
review (see below). It does not do trend/pattern analysis across multiple sessions —
that's Phase 7's job. This is single-session, closing-the-loop only.

## Trigger
Event-driven, manually invoked. The athlete says a workout is done and asks for a
review; there is no automatic or scheduled trigger in V1. Later phases could detect
a new review-worthy activity automatically — not built here.

## Review-Worthiness Test
Run this before starting a full review. An activity is review-worthy if any apply:
- It corresponds to a prior Daily Check-In recommendation (`state/checkins/*.md`).
- It was structured/deliberate: Norwegian 4x4, VO2 work, tempo/intervals, long run/ride.
- It's a strength/lifting session — lifting is the most reliable rotation-position
  signal (per `profile/schedule.md`), so every lift gets reviewed even if unremarkable.
- It was unusually hard relative to recent norms for that session type, judged after
  data-quality validation (CLAUDE.md's rule) — not raw Strava fields taken at face value.
- Pain, injury concern, or unexpected discomfort was reported. This always makes a
  session review-worthy regardless of what Strava shows — it can only come from the
  athlete, not from the data.
- It was unplanned but recovery-relevant (e.g. a surprise hard hike, extra volume
  that changes the recovery picture).

**Not review-worthy by default:** an easy/recovery walk with nothing notable
reported. The athlete can always override in either direction — skip a
review-worthy session, or request a review of something that wouldn't qualify by
default.

## Multiple Activities Same Day
`profile/schedule.md` explicitly supports same-day combining (cardio + lift), so this
comes up routinely. Each review-worthy activity gets its own review file, keyed by
Strava activity ID — a lift and a ride carry different signals (soreness vs.
cardiovascular fatigue) and blending them into one record loses fidelity. If asked to
review "today's workout" and more than one activity qualifies, confirm which one (or
do both in sequence) before writing anything. Carry-forward items generated from
same-day activities are still considered jointly by the next check-in — e.g. two hard
sessions in one day is worth surfacing as compounding fatigue, even though each has
its own review record.

## Read Pattern
1. Identify the candidate activity via Strava MCP `list_activities` (and
   `get_activity_performance` / `get_activity_streams` as needed) — activities since
   the last reviewed one.
2. Read the most recent relevant `state/checkins/YYYY-MM-DD.md` and identify which
   recommendation block (by `recommendation_id`) this activity would correspond to, if
   any — see Recommendation Matching below.
3. Apply data-quality validation (CLAUDE.md's "validate before calculating" rule)
   before comparing planned vs. actual — check `moving`/`has_heartrate`/
   `has_device_watts` and discard or flag anything structurally unreliable.
4. Confirm the review-worthiness test; if ambiguous or multiple candidates exist,
   confirm with the athlete which activity(ies) to review before proceeding.

## Recommendation Matching
Every review records how it relates to a prior recommendation — never silently:
- **`matched`** — the activity clearly corresponds to one identifiable
  `recommendation_id` (only the `active`/last-superseding block for that day counts as
  "what was actually in effect"). `recommendation_ref` is set to that id.
- **`no_recommendation`** — no prior recommendation exists to compare against (e.g. an
  unplanned session, or a day with no check-in). `recommendation_ref` is blank.
- **`ambiguous`** — a recommendation exists but doesn't cleanly match (timing,
  activity type, or multiple candidates make it unclear). **Do not force it into a
  slot.** `recommendation_ref` stays blank; say plainly in Observations that a match
  was considered and declined, and why.

## V1 Input Schema (post-workout, asked in one concise group)
| Field | Required | Type |
|---|---|---|
| adherence | REQUIRED | Followed / Modified / Substituted / Skipped / Unplanned-extra |
| rpe | OPTIONAL | 1-10 — one signal among several, never ground truth for intensity |
| knee_response | REQUIRED | Normal / Something felt off / Pain during / Pain after |
| pain_detail | OPTIONAL — asked only if knee_response is not Normal, or other new pain | free text |
| fatigue_after | REQUIRED | Normal / Higher than expected / Much higher than expected |
| context_note | OPTIONAL | free text — anything else notable about the session |

## Output Schema
One file per reviewed activity, at `state/reviews/YYYY-MM-DD-<activity_id>.md`. Treat
`activity_id` as an opaque string identifier (it's returned that way by Strava's MCP
tools) — never parsed or compared as a number:
```
---
activity_id: <strava id, string>
activity_date: <date>
activity_type: Run | Ride | Lift | Walk | ...
recommendation_match: matched | no_recommendation | ambiguous
recommendation_ref: rec_YYYYMMDD_NN | (blank)
adherence: Followed | Modified | Substituted | Skipped | Unplanned-extra
rpe: <1-10 | Not provided>
knee_response: Normal | Something felt off | Pain during | Pain after
pain_detail: ...
fatigue_after: Normal | Higher than expected | Much higher than expected
carry_forward_created: [<id>, ...] | none
---

Observations: directly reported or retrieved facts — the athlete's input-schema
answers, and raw Strava fields that passed data-quality validation. No interpretation
here.

Computed Facts: deterministic analytics output (Phase 7+), if any apply to this
activity — e.g. a validated pace or distance figure with its coverage/exclusions.
Often empty until Phase 7 supplies a relevant metric; say so plainly rather than
leaving the section ambiguous.

Coaching Interpretation: what the Observations and Computed Facts mean — comparison
against the matched recommendation (if any), why any carry-forward items were or
weren't created, which Strava fields were discarded and why (data-quality rule).
```

The three-way split is deliberate: Observations and Computed Facts must never be
blended with judgment, so that when Phase 7 starts populating Computed Facts, nothing
about this file's structure needs to change.

## Carry-Forward State
Stored in `state/carry-forward.md` — the one piece of state in this project that is
genuinely mutable rather than an append-only log (like schedule.md's rotation
position, it's live state without its own history file). This workflow creates,
weakens, strengthens, resolves, or expires items there; `coaching/daily-checkin.md`
reads active items on the other side.

### Schema
See `state/carry-forward.md` for the authoritative schema (kept in one place to avoid
drift). When this workflow resolves or supersedes an item, it sets `resolved_by` /
`superseded_by` to this review's own file path — never just prose in
`resolution_note`. When it weakens or strengthens an item without resolving it, it
sets `last_updated_by` / `last_updated_date` accordingly.

### When to create an item
Not every review produces one — only when there's a concern that should actively
shape the *next* session, beyond what's already visible by re-reading Strava. A
clean "followed as planned, felt normal" review creates nothing.

### Setting `resolution_requires`
The governing rule: **resolve a concern only when we have the type of evidence
necessary to answer it.** This is a one-time judgment call at creation, not a lookup
table:
- **`checkin`** — the concern is fundamentally about current/resting state: general
  fatigue, temporary soreness, poor recovery feeling, a sleep-related flag, a mild
  symptom expected to settle. A future check-in can answer this directly.
- **`post_workout_review`** — the concern can only be tested under load: knee
  discomfort during running (does it recur?), an interval session that ran too hard
  (did the reduced version work?), form deteriorating late in a long run, cycling
  intensity higher than intended. A clean check-in can weaken this but never resolve
  it — only the next relevant review (matching session type/domain) can.

### Resolving from this workflow's side
A post-workout review may resolve any active item with `resolution_requires:
post_workout_review`, if this activity is the relevant test for that concern (same
session type/domain as the original flag). It may escalate any active item —
regardless of `resolution_requires` — if evidence gets worse. It never resolves a
`checkin`-gated item; that side is `coaching/daily-checkin.md`'s job (see its
"Carry-Forward Interaction" section).

### Passive decay — correction
If an item is neither resolved nor escalated within its `max_lifespan`, that does
**not** auto-set `status: expired` (or `resolved`) — reaching `max_lifespan` only
means the item is due for **explicit reconsideration** the next time any workflow
reads `state/carry-forward.md`. Whoever reads it next surfaces it plainly and asks
whether it still applies; the status only changes as the outcome of that explicit
check, never from the calendar alone. This guards against silent infinite
accumulation without silently closing concerns just because time passed.

## Worked Examples

**Weakened but not resolved (`resolution_requires: post_workout_review`):**
- `2026-09-10` review (easy run): knee "something felt off" mid-run, no swelling —
  creates `cf-2026-09-10-knee`, concern "knee discomfort appeared during running
  load," guidance "next run shorter/easier than default, watch for recurrence,"
  `resolution_requires: post_workout_review` (only running again can answer this).
- `2026-09-11` check-in: knee Normal at rest, no pain — weakens the concern (severity
  softened), stays `active`. Output says so explicitly: "reassuring, but the concern
  stays open until the next run shows how the knee actually responds."
- `2026-09-13` review (the next run): no recurrence — *this* review resolves
  `cf-2026-09-10-knee`, noting the thing it was tracking has now actually been tested.

**Resolved by check-in (`resolution_requires: checkin`):**
- `2026-09-08` review (Norwegian 4x4 ride): unusually fatigued afterward, no injury
  signal — creates `cf-2026-09-08-fatigue`, concern "unusual post-session fatigue,"
  `resolution_requires: checkin` (a resting-state question).
- `2026-09-09` check-in: fatigue Fresh, sleep Good — resolved directly here, noting
  the resting-state concern has been answered.

## V1 Scope
**Does:** review-worthiness triage, per-activity review file keyed by Strava activity
ID, comparison against the prior recommendation when one exists, qualitative
carry-forward creation/resolution feeding into the next Daily Check-In.

**Does not (yet):** automatic/scheduled triggering, trend or pattern analysis across
multiple sessions (Phase 7), SQLite or any database, strength progression programming
(Phase 9).
