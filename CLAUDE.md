# Personal Trainer Agent

## What this project is

A personal fitness coaching agent built with Claude Code, with two equally important goals:

1. A genuinely useful personal trainer that analyzes workouts (via Strava) and guides training.
2. A teaching project for learning Claude Code and AI agent development, hands-on.

The user has a technical background but is new to Claude Code and agent
development. **Do not silently implement large chunks of this project.** Work in
small, explained milestones — see "How to work in this repo" below.

## Architecture rule: Strava access

Strava data (runs, walks, rides, weight sessions, etc.) is accessed **only** through
Strava's official MCP integration, treated as an external tool Claude queries live.

**Do not** build a custom pipeline that pulls Strava REST API data and feeds it to
Claude as a workflow step. Strava is a tool, not a data source we own.

Information Strava does *not* know about (goals, subjective fatigue, soreness, sleep,
injuries, planned workouts, coaching decisions) is stored locally in this project.

## Engineering philosophy: code calculates, Claude reasons

Deterministic numeric calculations (weekly mileage, rolling averages, pace, % change,
HR-zone distribution, etc.) must be written as actual code, not estimated by Claude
from raw data. Claude's job is to interpret the *results* of those calculations and
make coaching judgment calls — not to do arithmetic in its head.

This includes validating that a metric is actually meaningful before calculating from
it — e.g. Strava's distance/pace/velocity fields can be structurally unreliable for a
specific activity (such as a treadmill run) even when other fields (like heart rate)
remain valid for that same activity. Check data quality (e.g. via the `moving` stream,
or `has_heartrate`/`has_device_watts` flags) before computing derived metrics like pace
or mileage.

### Validation contract (Pre-Phase-7)
An activity never gets one global `valid` flag — validity is always specific to a
(activity, field-or-stream, metric) triple. Three levels, checked in order:
1. **Retrieval validity** — did the MCP call succeed and actually return the
   requested window/activity/field set (vs. an error, timeout, or partial page)?
2. **Field/stream validity** — for data that *was* retrieved, is a specific field or
   stream structurally usable and plausible for *this* activity (the
   `moving`/`has_heartrate`/`has_device_watts` check above, generalized)?
3. **Metric eligibility** — given the validated fields/streams available, does *this*
   calculation (e.g. pace) actually have what it needs? A metric can be ineligible
   even when every underlying field is individually valid, if the activity type
   doesn't support the calculation at all (pace on a lift isn't a data-quality
   problem, it's a category mismatch).

Five states, never collapsed into each other:
- **`not_retrieved`** — the call itself didn't return this data (error/timeout/partial
  pagination) — different from data that was retrieved but is absent.
- **`missing`** — the call succeeded; this field/stream is genuinely absent (e.g. no
  `avg_cadence` on a walk).
- **`invalid`** — the field/stream is present but fails a plausibility/structural
  check for this activity (e.g. GPS distance on a treadmill run).
- **`unsupported`** — this metric doesn't apply to this activity's type at all,
  regardless of data quality.
- **`legitimate_zero`** — present, valid, and genuinely zero (e.g. `elevation_gain: 0`
  on a flat treadmill run) — must never be confused with `missing` or `not_retrieved`.

### MCP → deterministic-code capture boundary
Strava MCP tool responses that feed deterministic analytics (Phase 7+) are captured
raw by a `PostToolUse`/`PostToolUseFailure` hook (`.claude/hooks/capture-strava.js`,
configured in `.claude/settings.json`), not by Claude retyping numbers into a file.
The hook writes verbatim output to `state/.raw-capture/` (gitignored — never commit
raw Strava responses); deterministic code reads only from there. This matters most
for large responses (e.g. activity streams): Claude's own context receives a
truncation notice, not the data, once a response exceeds the harness's token budget —
so for exactly the payloads where manual transcription risk would be highest, Claude
structurally never sees the full numbers at all. Confirmed experimentally, not assumed
— see the Pre-Phase-7 Architecture Contract milestone commit.

## How to work in this repo

- Small milestones, explained as we go — not large unexplained changes.
- Don't introduce cloud infra, React, AWS, Docker, vector DBs, or microservices unless
  an actual problem requires it. Start simple.
- Don't build ahead of the current phase (see below) unless explicitly asked.
- This is a fitness coaching tool, not a medical diagnostic system. If something in
  the data suggests a possible injury/illness, say so plainly rather than diagnosing it.
- When information needed for a coaching decision is missing, be conservative.
- Don't treat self-reported perceived exertion (RPE) as ground truth for training
  intensity — it doesn't reliably track HR/power-implied effort. Treat it as one
  signal among several.

## Project phase status

- **Phase 1 — Claude Code Foundations: done.** Git repo initialized, `CLAUDE.md` +
  `README.md` committed, tool permissions model covered, Node upgraded to v24.20.0.
- **Phase 2 — Connect Strava MCP: done.** The `strava-mcp` server is registered
  (local scope, remote HTTP transport at `https://mcp.strava.com/mcp`, OAuth-authenticated)
  and confirmed working. Available tools: `get_athlete_profile`,
  `get_athlete_zones`, `list_activities`, `get_activity_performance`,
  `get_activity_streams`, `get_strength_workout_details`, `get_training_plan`,
  `get_gear`, `get_club_info`, `eligibility`, `health`. Explored real data (recent
  activities, one run, one ride) before designing any coaching workflow — see the
  data-validation rule above, which came directly out of that exploration. Note: it's
  read-only — cannot write to Strava.
- **Phase 3 — Athlete Profile: done.** `profile/athlete.md`, `profile/goals.md`, and
  `profile/schedule.md` created after a design discussion (four context categories:
  stable info, goals, schedule, temporary state — only the first three stored here,
  temporary state is deferred to Phase 4). Populated via a grouped interview rather
  than guessed. Note: schedule.md records scheduling *policy* (e.g. rolling-not-resetting)
  but not live position in the rotation — that's state without a home yet.
- **Phase 4 — Daily Check-In: done.** Workflow documented in `coaching/daily-checkin.md`
  (read pattern, input schema, decision flow, rolling-schedule rules, safety tiers,
  output schema). Daily records saved as one Markdown file per day under `state/`.
  Design was validated with a live conversational prototype before implementation,
  which surfaced two real fixes folded into the workflow doc: session framing (avoid
  the "what should I do today" ambiguity once today's session is already logged) and
  a categorical (not numeric) time-availability field. No code, database, or
  automation yet — this phase is a documented manual workflow, run conversationally.
- **Phase 5 — Post-Workout Review: done.** Workflow documented in
  `coaching/post-workout-review.md` (trigger model, review-worthiness test,
  per-activity output schema). Locked via a design discussion before implementation —
  three decisions in particular: (1) event-driven/manual trigger in V1, with a
  qualitative review-worthiness test rather than reviewing every activity; (2)
  `state/checkins/` and `state/reviews/` as separate directories, review files keyed
  by Strava activity ID to handle same-day multiples unambiguously; (3) a
  carry-forward mechanism (`state/carry-forward.md`) so a review's findings can shape
  the next Daily Check-In without becoming a permanent rule. The key nuance on that
  last point: each carry-forward item declares `resolution_requires: checkin |
  post_workout_review` — a resting-state concern (general fatigue, sleep) can be
  resolved by a clean check-in, but a load-dependent concern (knee under running,
  whether an interval adjustment worked) can only be weakened by a check-in and must
  be resolved by the next relevant review. `state/2026-09-05.md` moved to
  `state/checkins/2026-09-05.md` to fit the new structure. No automatic triggering,
  trend analysis, or database yet — same manual-workflow scope as Phase 4.
- **Phase 6 — Weekly Review: done.** Workflow documented in
  `coaching/weekly-review.md` (review-period selection, reasoning flow, output
  schema, carry-forward interaction). Locked via a design discussion before
  implementation, same as Phase 5. Three decisions worth remembering: (1) "weekly"
  is a `review_period` — a 7-day observation *window*, never a training-cycle
  boundary; the rolling schedule underneath is untouched, and completing a review
  never resets rotation position or treats missed sessions as abandoned; (2) strict
  application of "code calculates, Claude reasons" — V1 does no cross-session
  arithmetic (no mileage totals, averages, % change, zone distribution, load scores),
  since Phase 7 (deterministic analytics) doesn't exist yet; it reasons only from
  session-level facts and qualitative pattern recognition (simple counts and
  word-level comparisons are allowed, computed percentages are not); (3) reviews save
  to `state/weekly-reviews/YYYY-MM-DD.md`, named by when the review happened (not a
  week number), with `period_start`/`period_end` in frontmatter. It reuses Phase 5's
  carry-forward mechanism as the only feed-forward channel into Daily Check-In (no
  changes needed to `daily-checkin.md`'s read pattern) — Weekly Review may create new
  carry-forward items, but only for patterns visible at the weekly altitude that no
  single check-in or review would catch alone (e.g. a session type repeatedly
  displaced across the period). Designed so Phase 7's analytics can later plug in as
  another input without a redesign.
- **Pre-Phase-7 Architecture Contract: done.** Prompted by an external architecture
  review before starting Phase 7 — conclusion was to keep the architecture and phase
  sequence, but tighten several contracts at the boundary between the (mostly
  prose-driven) coaching workflows and the deterministic analytics layer about to be
  introduced. All changes additive, no database/event-sourcing/scheduler engine:
  (1) stable `recommendation_id` (`rec_YYYYMMDD_NN`) with same-day revision handled by
  appending a new block and flipping the prior one to `status: superseded`, rather
  than editing history in place; (2) explicit `recommendation_match: matched |
  no_recommendation | ambiguous` on Post-Workout Review, so an ambiguous activity is
  never silently forced into a slot; (3) structured carry-forward references
  (`last_updated_by`, `resolved_by`, `superseded_by`) instead of prose-only
  resolution notes; (4) a correction to passive decay — reaching `max_lifespan` now
  triggers explicit reconsideration, never an automatic `status` change, since time
  passing alone must never resolve a concern; (5) Post-Workout Review's reasoning
  split into Observations / Computed Facts / Interpretation, so Phase 7's numeric
  output has a reserved slot instead of getting blended into narrative judgment;
  (6) `profile/schedule.md` gained session-purpose vocabulary (retained / replaced /
  dropped / evidence-for-reconsideration) and a one-line fixed-events-don't-roll
  policy; (7) the validation contract above (three levels, five states, no global
  `valid` flag); (8) the MCP → deterministic-code capture boundary above, verified
  experimentally via a real `PostToolUse`/`PostToolUseFailure` hook rather than
  assumed. See the commit for this milestone for the full before/after.
- **Phase 7 — Deterministic Analytics: done.** Two vertical-slice metrics under
  `src/analytics/`, each locked via a contract doc before implementation and
  explicitly scoped to itself (`CONTRACT-trailing-running-distance.md`,
  `CONTRACT-hr-zone2-time.md`) — no further metrics without a separate design
  discussion. `trailing_running_distance`: trailing-168h mileage from summary
  fields, with `is_trainer`/`moving_time` eligibility checks that caught two
  real corrupted records (a treadmill run and a GPS-failure run). Zone 2 time:
  time-series HR-stream attribution against live `get_athlete_zones` config,
  proving eligibility is metric-specific rather than activity-specific (a
  treadmill run invalid for distance was valid for Zone 2 time). Both reuse
  the same window/dedup code so "trailing 168h" has one meaning everywhere.
  Closing commit also fixed a real retrieval-completeness bug (a paginated
  `list_activities` response with `has_next_page:true` had been silently
  treated as complete) and backtested both metrics against 3 real historical
  windows (67 tests passing). **Recommendation from that closing review:
  defer Phase 8 (persistent state/SQLite)** — `state/` doesn't yet have enough
  real volume (one check-in file) to show that per-day Markdown files are
  actually a problem SQLite would solve. Revisit once real usage volume makes
  the case, not on a fixed phase-number schedule.

**Important operational note:** the Strava MCP registration lives in
`C:\Users\<user>\.claude.json`, which is user-local and NOT in this git repo. It also
requires a one-time OAuth step (`/mcp` inside a Claude Code session). New machines, or
sessions started *before* the server was registered, will not see its tools — MCP tool
discovery happens once at session startup, not live. If Strava tools seem unavailable,
check whether this is a session that predates registration before assuming something
is broken.

See full phase plan in project notes (Phases 1–12: foundations, Strava MCP, athlete
profile, daily check-in, post-workout review, weekly review, deterministic analytics,
persistent state/SQLite, strength logging, skills, subagents, standalone SDK app).
Do not jump ahead to later phases without discussion.

## Project structure (grows as phases require it)

```
personal-trainer-agent/
├── CLAUDE.md
├── README.md
├── .claude/
│   ├── settings.json          — hooks config (Strava MCP capture boundary)
│   └── hooks/
│       └── capture-strava.js  — PostToolUse/PostToolUseFailure capture, Strava-only
├── profile/
│   ├── athlete.md   — stable athlete info (sports, experience, durable + active limitations)
│   ├── goals.md     — current goals, priorities, conflict-resolution rules
│   └── schedule.md  — recurring training pattern and preferences (policy, not a log)
├── coaching/
│   ├── daily-checkin.md       — the Daily Check-In workflow spec (process, not data)
│   ├── post-workout-review.md — the Post-Workout Review workflow spec (process, not data)
│   └── weekly-review.md       — the Weekly Review workflow spec (process, not data)
└── state/
    ├── checkins/
    │   └── YYYY-MM-DD.md              — one file per day's check-in + recommendation
    ├── reviews/
    │   └── YYYY-MM-DD-<activity_id>.md — one file per reviewed activity
    ├── weekly-reviews/
    │   └── YYYY-MM-DD.md               — one file per performed review (review_date-named,
    │                                      period_start/period_end recorded inside)
    ├── carry-forward.md               — live, mutable list of unresolved concerns
    │                                     (the one exception to append-only state)
    └── .raw-capture/                   — gitignored; raw Strava MCP responses captured
                                          verbatim by the PostToolUse hook (Phase 7+ input,
                                          never committed, never hand-transcribed)
```

More directories (`src/`, `tests/`, `.claude/skills/`) get added when their phase
actually starts. Note the `coaching/` vs. `state/` split: `coaching/` holds *how* the
trainer reasons (stable, rarely changes), `state/` holds *what happened on a given
day* (grows daily, never edited after the fact) — the same separation-of-concerns
principle behind splitting `profile/` into three files, one level up. Within `state/`,
`checkins/` and `reviews/` are append-only logs; `carry-forward.md` is deliberately
different — live state that gets edited in place, analogous to how `schedule.md`
records rotation *policy* without tracking live position in it.
