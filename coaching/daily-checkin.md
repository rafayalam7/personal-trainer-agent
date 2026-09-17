# Daily Check-In Workflow (Phase 4 V1)

## Purpose
Answer "what should I do next?" using recent Strava activity, the athlete profile,
goals, schedule policy, and today's subjective state. This is not a general wellness
questionnaire — it collects only the temporary information that can materially change
today's training recommendation.

## Read Pattern (run at the start of every check-in)
1. Read `profile/athlete.md` — sports, experience, durable limitations, active injury
   status/restrictions.
2. Read `profile/goals.md` — primary/secondary goals, governing priority hierarchy,
   conflict-resolution rules.
3. Read `profile/schedule.md` — ideal rotation template, rolling-not-resetting policy.
4. Query Strava MCP `list_activities` for the last ~10-14 days.
5. Apply data-quality validation (CLAUDE.md's "validate before calculating" rule) to
   every activity before using it — check `moving`/`has_heartrate`/`has_device_watts`,
   cross-check distance/duration for plausibility against the activity's own
   description, and discard or flag anything that looks broken (duplicate uploads,
   near-zero-duration entries, etc.) rather than trusting it by default.
6. Read `state/carry-forward.md` for any `status: active` items (see
   `coaching/post-workout-review.md`, Phase 5) — unresolved concerns from a recent
   Post-Workout Review that this check-in should weigh alongside today's fresh signals.

## Session Framing
Before asking anything, check whether today's date already has a completed activity
in Strava.
- If yes: state plainly that this check-in is for the *next* session, not today's
  already-completed one, before asking anything else.
- If no: proceed treating "today" literally.

(Added after live prototype testing on 2026-09-04 — "what should I do today" broke
down the first time it was tried, because that day's session was already done. Don't
skip this step; it's cheap insurance against a real, observed confusion.)

## V1 Input Schema (asked in one concise group, after Session Framing)
| Field | Required | Type |
|---|---|---|
| fatigue | REQUIRED | Fresh / Normal / Fatigued / Drained |
| knee_status | REQUIRED | Normal / Something feels off / Pain present |
| knee_detail | OPTIONAL — asked only if knee_status is not Normal | free text (stable vs. worsening, affects normal walking, changes during warm-up, swelling/instability) |
| new_pain | REQUIRED | Yes/No + optional location |
| time_available | REQUIRED | Tight (<30 min) / Moderate (30-60) / Ample (60-90) / Wide open (90+) |
| sleep_quality | OPTIONAL | Good / Okay / Poor |
| context_note | OPTIONAL | free text — schedule deviations, anything else different |

Everything else (recent training, HR/power availability, rotation position) is
inferred from Strava + the profile files — never asked, since asking for it would be
redundant with data the system can already see.

## Decision Flow
```
Recent Strava (validated) ─┐
Profile: Goals/Priority    ─┤
Profile: Schedule Policy   ─┼─► A. Infer rotation position
Profile: Restrictions      ─┘     (baseline candidate → missed-important-session
                                    check → spacing check → no-cramming cap)
Today's Check-in ───────────────────────┤
  (fatigue, knee+detail, pain,           ▼
   time, sleep, context)       B. Hard Safety Gate
Carry-Forward (active items) ──┘  (pain / knee escalation factors, plus any
                                    active carry-forward concern → tier)
                                        │
                         ┌──────────────┴──────────────┐
                    fails gate                     passes gate
                         │                               ▼
              → Rest/substitute/clinical        C. Candidate Workout
                recommendation                          │
                (skip to output)                         ▼
                                    D. Soft Adjustment
                                    (fatigue + sleep tiebreak → intensity;
                                     time_available → duration/distance fit;
                                     active carry-forward guidance folded in)
                                                          │
                                                          ▼
                                    E. Recommendation + Explanation
                                                          │
                                                          ▼
                                    F. Update Carry-Forward State
                                    (resolve any checkin-gated item today's
                                     signal directly answers; weaken/strengthen
                                     any item that's relevant but not resolved;
                                     leave post_workout_review-gated items
                                     untouched unless evidence worsens)
```

## Rolling-Schedule Rules
- Rotation position is re-inferred fresh from recent Strava activity every time —
  never a persisted pointer.
- Lifting (Hevy-logged, clean names) is usually the most reliable signal for rotation
  position. Cardio "flavor" (easy/Norwegian/long) is noisier in practice and may need
  to be called out as uncertain rather than assumed.
- Missed sessions don't vanish: high-value session types (leg day, VO2/Norwegian work,
  long run/ride) get *preferred* rescheduling if current state allows it; routine easy
  sessions just lapse.
- Never stack demanding sessions back-to-back to "catch up" — recovery spacing after
  a hard effort takes priority over sequence fidelity.
- Never recover more than one missed important session at a time — no cramming.
- The safety gate always overrides sequence-preservation, no exceptions.
- If a lack of rest days is visible in recent history, surface it as an observation
  even when nothing in today's check-in flags a problem — it's relevant context, not
  necessarily an override.

## Safety Tiers
Proceed normally → Reduce load → Substitute → Rest → Advise clinical follow-up.
Knee-status routing is qualitative (weighing stability, effect on normal function,
warm-up behavior, swelling/instability from `knee_detail`) — never a fixed
category-to-action lookup table. Any mention of swelling, instability, or a
worsening trend escalates toward rest or clinical follow-up regardless of how mild
the initial report sounded. Never diagnose — only recognize that something warrants
outside evaluation and say so plainly.

## Carry-Forward Interaction (Phase 5)
Active items from `state/carry-forward.md` are weighed alongside today's fresh
signals, not treated as settled fact — a prior concern is evidence, today's
check-in is current state, and the two get reconciled together (see
`coaching/post-workout-review.md` for the full carry-forward design). The
resolution rule is: **resolve a concern only when we have the type of evidence
necessary to answer it.**
- An item with `resolution_requires: checkin` can be resolved outright today if
  the fresh signal directly answers it (e.g. a general-fatigue flag cleared by a
  Normal/Fresh report and good sleep).
- An item with `resolution_requires: post_workout_review` can be weakened by a
  clean check-in (say so explicitly — "reassuring, but stays open until we see
  how it responds under load") but never resolved here; only the relevant next
  Post-Workout Review can close it out.
- Either kind can be escalated immediately if today's evidence is worse, regardless
  of `resolution_requires`.
- After the recommendation is written, update `state/carry-forward.md` in place to
  reflect whatever was resolved, weakened, strengthened, or left untouched — setting
  `resolved_by` (when resolving) or `last_updated_by`/`last_updated_date` (when
  weakening/strengthening) to this check-in's file, not just prose.
- If an active item has passed its `max_lifespan`, that alone never resolves or
  expires it — surface it plainly today and let the athlete's answer (or lack of new
  evidence either way) be the actual resolution, per `state/carry-forward.md`'s
  Passive Decay correction.

## Output Schema
```
recommendation_id: rec_YYYYMMDD_NN
status: active
recommendation: <activity>
intensity: <Easy | Moderate | Hard>
duration_or_distance: <approximate, fit to time_available>
avoid: <specific things to skip today>
reasoning: <explicitly separated: what came from Strava / profile / today's check-in>
override_conditions: <what would change this mid-session>
goal_linkage: <one line tying it back to the primary goal>
```

`recommendation_id` is the stable identity a later Post-Workout Review points back to
(Phase Pre-7) — not an ID framework, just `rec_<date>_<sequence>` reliably unique within
this project. Sequence starts at `01` and only increments on a same-day revision (see
below). `status` is `active` unless a same-day revision has superseded it.

## Same-Day Revision
If the recommendation is revised later the same day (not just followed/modified at
workout time — an actual change to the plan before the athlete trains), do not edit the
existing block. Append a new recommendation block below it with the next sequence
(`rec_YYYYMMDD_02`, ...) and flip the prior block's `status` to `superseded`. This keeps
one file per day while still answering "which version was actually in effect" without
rewriting history.

## Daily State File
One file per check-in, at `state/checkins/YYYY-MM-DD.md`. One or more recommendation
blocks (see Same-Day Revision), each with its own frontmatter:
```
---
recommendation_id: rec_YYYYMMDD_01
status: active | superseded
for_session: today | next
fatigue: ...
knee_status: ...
knee_detail: ...
new_pain: ...
time_available: ...
sleep_quality: ...
context_note: ...
recommendation: ...
---

Reasoning: ...
```

## V1 Scope
**Does:** short conversational check-in, live Strava + profile reads every time,
best-effort rotation inference, qualitative safety gate, structured recommendation,
one Markdown file per day.

**Does not (yet):** SQLite or any database, subagents, a web app, autonomous/scheduled
triggering, notifications, trend/analytics logic (Phase 7), or full strength
progression programming (Phase 9). Whether a recommendation was actually followed is
now tracked — see `coaching/post-workout-review.md` (Phase 5) — and its output feeds
back in here via `state/carry-forward.md`.
