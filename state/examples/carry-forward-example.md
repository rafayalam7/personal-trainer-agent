<!-- EXAMPLE — synthetic data, not a real coaching record. See state/examples/README.md. -->

This shows the carry-forward item `review-example.md` creates, in the same schema
`state/carry-forward.md` uses for real (currently empty) live state:

```yaml
items:
  - id: cf-2026-10-01-knee
    created: 2026-10-01
    source_review: state/reviews/2026-10-01-90000000099.md
    last_updated_by: null
    last_updated_date: null
    category: knee_concern
    concern: Mild knee sensation reported at check-in; not yet tested under running load.
    why_it_matters: Running is the load type most likely to reproduce or worsen it.
    guidance: First run back should stay easy and short; stop immediately if the sensation returns.
    resolution_requires: post_workout_review
    severity: watch
    max_lifespan: 3 check-ins
    status: active
    resolved_date: null
    resolved_by: null
    superseded_by: null
    resolution_note: null
```

The next Daily Check-In reads this as an active item and weighs it alongside that
day's fresh signals — per `coaching/daily-checkin.md`'s Carry-Forward Interaction
rules, a check-in with no running signal could only weaken this further, never
resolve it; only the athlete's next actual run (reviewed via
`coaching/post-workout-review.md`) can close it out.
