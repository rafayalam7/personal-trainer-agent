# Carry-Forward Coaching State

Live, mutable list of unresolved concerns raised by Post-Workout Review
(`coaching/post-workout-review.md`) that the next Daily Check-In
(`coaching/daily-checkin.md`) should weigh alongside today's fresh signals. Unlike
`state/checkins/` and `state/reviews/`, which are append-only logs, this file is
edited in place as items are created, weakened, strengthened, resolved, or expired —
the same kind of live state as the rotation position `profile/schedule.md`
deliberately doesn't track on its own.

Governing rule: resolve a concern only when we have the type of evidence necessary
to answer it (see `resolution_requires` on each item).

## Schema
```yaml
items:
  - id: cf-<created-date>-<short-slug>
    created: <date>
    source_review: state/reviews/<file>.md      # which evidence created this concern
    last_updated_by: state/checkins|reviews/<file>.md | null   # which evidence last
                                                                # weakened/strengthened it
    last_updated_date: <date> | null
    category: knee_concern | unusual_fatigue | session_harder_than_planned |
              rotation_deviation | recovery_priority
    concern: <what's being tracked, one line>
    why_it_matters: <the risk if ignored, one line>
    guidance: <what it means for the next session, one line>
    resolution_requires: checkin | post_workout_review   # what type of evidence can resolve it
    severity: watch | caution | elevated
    max_lifespan: <e.g. "3 check-ins" or "7 days">
    status: active | resolved | expired | superseded
    resolved_date: <null until resolved>
    resolved_by: state/checkins|reviews/<file>.md | null   # what actually resolved/
                                                            # superseded it — a real
                                                            # file reference, not prose
    superseded_by: <id> | null
    resolution_note: <null until resolved>
```

`last_updated_by`/`last_updated_date` are set whenever a check-in or review weakens or
strengthens an item without resolving it — the existing "weakened but not resolved"
worked example below already does this in practice; this just makes it a queryable
field instead of only living in prose.

## Active Items
```yaml
items: []
```

## Resolved / Expired History
(none yet — resolved and expired items are kept here for a while for context, then
pruned periodically since this file is meant to stay small)

## Passive Decay — Correction
`max_lifespan` being reached does **not** automatically set `status: resolved` (or
`expired`) — reaching it only means the item is due for **explicit reconsideration**,
not automatic closure. Whichever workflow next reads this file (Daily Check-In,
Post-Workout Review, or Weekly Review) surfaces it plainly — "this concern has passed
its expected lifespan without new evidence; does it still apply?" — and a status
change only happens as the outcome of that explicit check, same as any other
resolution. This is a status observation prompting a decision, never a decision made
by the calendar alone, and it is never triggered solely because Weekly Review ran.
