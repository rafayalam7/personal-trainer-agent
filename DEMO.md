# Demo Sequence (2–3 minutes)

A short walkthrough for a recording or a live interview demo. Use the sanitized
examples under [`state/examples/`](state/examples/) for anything shown on screen —
never real personal check-in/review content, which is intentionally gitignored (see
`README.md`'s Privacy section).

1. **Show the repo** — `profile/`, `coaching/`, `state/`, `src/analytics/`. One line:
   this is a coaching agent built inside Claude Code, not a chatbot wrapper.
2. **Show Strava MCP** — the registered MCP tools in the session (`list_activities`,
   `get_activity_streams`, `get_athlete_zones`, etc.). Note: official integration,
   read-only, no custom API pipeline.
3. **Run/show a Daily Check-In** — use `state/examples/checkin-example.md`'s scenario
   (mild knee sensation reported) rather than a real check-in.
4. **Show the resulting recommendation** — the structured output with reasoning split
   by source (Strava / profile / today's check-in), and the safety-gate downgrade it
   triggers.
5. **Show deterministic analytics output** — run one metric CLI live against a
   sanitized fixture, e.g.:
   ```
   node src/analytics/run-trailing-running-distance.js <windowEndIso> tests/fixtures/real/outdoor-run-valid.json
   ```
   Show the structured JSON: `coverage.status`, `exclusions`, `provenance`.
6. **Show one corrupted/missing-data example** — the zero-distance treadmill run
   (`tests/fixtures/real/treadmill-run-invalid.json`) that's invalid for the distance
   metric but eligible for Zone 2 time — the strongest single technical beat in the
   project. Give it real time.
7. **Show a Post-Workout Review example** — `state/examples/review-example.md`,
   pointing out `recommendation_match: matched` and the carry-forward item it creates
   (`state/examples/carry-forward-example.md`) because the concern wasn't actually
   tested under running load.
8. **End on the architecture diagram and the two principles** — README's Mermaid
   diagram, closing on "code calculates, Claude reasons" and "validate before
   calculating."

Keep it to these eight beats — this is a demo, not a tutorial.
