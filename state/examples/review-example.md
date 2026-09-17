<!-- EXAMPLE — synthetic data, not a real coaching record. See state/examples/README.md. -->

---
activity_id: "90000000099"
activity_date: 2026-10-01
activity_type: Ride
recommendation_match: matched
recommendation_ref: rec_20261001_01
adherence: Followed
rpe: 4
knee_response: Normal
pain_detail:
fatigue_after: Normal
carry_forward_created: [cf-2026-10-01-knee]
---

Observations:

From Strava: "Easy Spin" (Ride), 32 minutes, low average heart rate consistent with
an easy-effort session. The Push lift recorded separately the same day, both matching
the recommendation.

From athlete: adherence Followed; knee response Normal during the ride; fatigue after
Normal.

Computed Facts:

No Phase 7 deterministic metric applies — both implemented metrics are scoped to
`Run` activities only, and this session was a Ride and a Lift.

Coaching Interpretation:

`recommendation_match` is `matched` against `rec_20261001_01`, which specifically
routed the athlete away from running today because of the knee sensation reported at
check-in. The ride felt normal, which is reassuring, but it does not actually test
the thing the original concern was about — running load specifically. Per
`coaching/post-workout-review.md`'s resolution rule, a concern can only be resolved by
the type of evidence that can answer it; a non-running session can weaken this
concern but not resolve it. `cf-2026-10-01-knee` is created with
`resolution_requires: post_workout_review`, to be resolved only by the athlete's next
run.
