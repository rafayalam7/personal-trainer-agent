// Explicit Phase 7 configuration — see src/analytics/CONTRACT-trailing-running-distance.md for the reasoning
// behind each value. Nothing here is invented at calculation time; every constant
// used by eligibility.js or a metric function is named and versioned here.
module.exports = {
  // Bumped: the normalized activity shape changed (interpreted_utc_offset ->
  // interpreted_timezone + resolved_utc_offset_minutes) when the fixed-offset
  // timezone approach was replaced with IANA-zone + DST-aware resolution.
  schemaVersion: 2,

  // Re-checked directly against real captured MCP payloads (not just
  // get_athlete_profile): no machine-readable timezone or absolute-UTC start
  // field exists anywhere in list_activities, get_activity_performance, or
  // get_activity_streams responses — only the naive local `start_local` string.
  // Timezone is therefore explicit local configuration, not something derived
  // from any MCP field, not a lookup service, not geographic inference from
  // athlete.location. Resolution to UTC uses Node's built-in Intl (full ICU,
  // ships with Node by default) against this IANA zone — correctly DST-aware,
  // unlike a fixed offset. See CONTRACT-trailing-running-distance.md "Timezone" for the full reasoning
  // and src/analytics/normalize.js for the resolution algorithm.
  timezone: "America/Chicago",

  // Exact-match only. Anything not listed here (TrailRun, VirtualRun, ...) is
  // deliberately "other" in V1 — out of scope, not guessed at.
  sportClassification: {
    Run: "run",
    Ride: "ride",
    WeightTraining: "lift",
    Walk: "walk",
  },

  // Athlete's measurement_preference is "Imperial" per get_athlete_profile — used
  // only for display conversion in Weekly Review, never inside the metric itself.
  displayUnit: "mi",
  metersPerMile: 1609.344,

  trailingRunningDistance: {
    // v1->v2: window boundary convention changed from both-inclusive to
    // half-open (window_start, window_end] — see CONTRACT-trailing-running-distance.md "Window boundary
    // convention". This changes which activities a boundary-adjacent result
    // includes, so results computed under version 1 are not directly comparable.
    // v2->v3: is_trainer (treadmill/indoor) removed as an eligibility gate —
    // see CONTRACT-trailing-running-distance.md "Trainer status is provenance,
    // not eligibility evidence". A real Technogym Skillrun treadmill sync
    // (2026-09-16) proved is_trainer:true no longer implies broken distance
    // data; eligibility now depends only on distance/moving_time evidence, the
    // same evidence that already existed. Results computed under version 2 may
    // classify a treadmill run's distance as invalid where version 3 does not.
    metricVersion: 3,
    windowHours: 168,
    // A metric-eligibility HEURISTIC, not a universal definition of a valid run.
    // Named and versioned here deliberately (bump metricVersion if this value
    // ever changes) so a future revision is visible in every result's
    // provenance, not a silent behavior change. Justified by two real corrupted
    // records found during Pre-Phase-7 exploration (moving_time of 2s and 8s on
    // activities otherwise structurally plausible) — appropriate for V1, but
    // revisit if future real data shows it excluding genuinely valid short runs
    // or admitting a broken one.
    minMovingTimeSeconds: 60,
  },

  heartRateZoneTime: {
    metricVersion: 1,
    windowHours: 168,
    // Strava's own zone-numbering convention: heart_rate_zones is an ascending
    // array, index 0 = Zone 1, index 1 = Zone 2, ... confirmed against a real
    // get_athlete_zones response. Never derived from age/max-HR formulas.
    zone2Index: 1,
    // PROVISIONAL. Versioned config, not a physiological claim. No real gapped
    // HR stream was found in this athlete's history to validate this number
    // against (every real stream inspected was either densely 1Hz-sampled or
    // too short to show a gap) -- unlike minMovingTimeSeconds above, which two
    // real corrupted records justified. Bump metricVersion if this is revised
    // once real evidence (a genuine gap) appears; do not add further
    // thresholds without the same bar.
    maxGapSeconds: 30,
  },
};
