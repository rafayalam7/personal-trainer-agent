<!-- EXAMPLE — synthetic data, not a real coaching record. See state/examples/README.md. -->

---
recommendation_id: rec_20261001_01
status: active
for_session: today
fatigue: Normal
knee_status: Something feels off
knee_detail: Mild tightness noticed during warm-up yesterday, no swelling, doesn't affect normal walking.
new_pain: No
time_available: Moderate (30-60)
sleep_quality: Good
context_note:
recommendation: Push (lift) + easy spin, no running
---

Reasoning:

From Strava: recent history shows a leg-focused lift two days ago and an easy run
yesterday — Push is the next slot in the rotation template and doesn't stack
lower-body load again so soon.

From profile: the athlete's active knee restriction (`profile/athlete.md`) means
running progression should stay conservative and health/durability takes priority
over training progression — today's "something feels off" report is exactly the
kind of signal that restriction exists for.

From today's check-in: knee_status is not Normal, so the Hard Safety Gate applies —
this downgrades the plan from a Reduce-load tier to a Substitute tier: running is
avoided today entirely in favor of a low-impact cardio option (easy spin), while the
already-scheduled upper-body lift proceeds unchanged since it doesn't load the knee.

Override conditions: stop the spin and reassess if any knee discomfort appears during
the session, even mild; the lift proceeds only if warm-up doesn't reproduce the
tightness.
