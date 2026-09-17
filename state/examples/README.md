# Example Coaching Walkthrough (Synthetic Data)

Everything in this directory is **fabricated example data**, written to demonstrate
the file formats and reasoning pattern described in `coaching/daily-checkin.md` and
`coaching/post-workout-review.md`. None of it is real training history, and none of
it came from a real Strava account.

The project's actual daily check-ins and workout reviews live in `state/checkins/`
and `state/reviews/`, which are gitignored and never published — see `CLAUDE.md`
and `.gitignore` for why.

## The walkthrough

1. [`checkin-example.md`](checkin-example.md) — a Daily Check-In: the athlete reports
   mild knee sensation alongside otherwise normal signals; the workflow's safety gate
   downgrades the plan and avoids running for the day.
2. The athlete trains as recommended (upper-body lift + easy spin, no running).
3. [`review-example.md`](review-example.md) — the resulting Post-Workout Review: the
   session felt fine, but because it didn't involve running, the knee concern can only
   be *weakened*, not resolved — it stays open until a run actually tests it.
4. [`carry-forward-example.md`](carry-forward-example.md) — the carry-forward entry
   that review produces, in the same schema `state/carry-forward.md` uses for real
   (currently empty) live state, showing how it would be picked up by the *next*
   Daily Check-In.

This mirrors the real file formats and `recommendation_id` / `activity_id` /
`carry-forward` linkage exactly — only the content is invented.
