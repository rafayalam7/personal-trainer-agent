// Metric-specific eligibility. Deliberately NOT a generic `activity.valid` flag —
// this function answers one question only: is this activity's distance eligible
// for the trailing-running-distance metric? A different future metric (pace, HR
// zones, ...) would have its own eligibility function and could reach a different
// verdict on the exact same activity. See CONTRACT-trailing-running-distance.md for the precedence order and
// why each check exists.
//
// `is_trainer` (treadmill/indoor vs. outdoor) is deliberately NOT checked here.
// It is provenance/context on the normalized activity (source/debugging context,
// coaching explanations, future pace/source-specific interpretation) but it is
// not evidence about whether THIS activity's distance/duration data is usable —
// treadmill sources vary (a broken manual-stub record vs. a real Technogym
// Skillrun sync), and outdoor sources can be just as broken (GPS failure). Only
// the distance/moving_time evidence below decides eligibility, regardless of
// source label, including when the label itself is unknown (null).
//
// Returns { eligible: boolean, state: "valid"|"missing"|"invalid"|"unsupported", reason: string|null }
// "legitimate_zero" is defined but never returned here — see the zero-distance
// check below for why a recorded zero on a Run is treated as invalid, not
// legitimate, in V1.
function eligibilityForTrailingRunningDistance(activity, config) {
  if (activity.internal_activity_type !== "run") {
    return {
      eligible: false,
      state: "unsupported",
      reason: `sport classified as "${activity.internal_activity_type}", not "run"`,
    };
  }

  if (activity.distance.value_m === null) {
    return { eligible: false, state: "missing", reason: "distance field absent from activity summary" };
  }

  if (activity.moving_time_s === null) {
    return {
      eligible: false,
      state: "invalid",
      reason: "moving_time not available; cannot assess structural plausibility",
    };
  }

  // minMovingTimeSeconds is a metric-eligibility HEURISTIC (config.js,
  // versioned via metricVersion) -- not a universal definition of what makes a
  // run "valid." It exists only to catch the specific real corruption pattern
  // found in this athlete's history and may be revised if future real data
  // shows it wrongly excluding a genuinely short run or admitting a broken one.
  const minMoving = config.trailingRunningDistance.minMovingTimeSeconds;
  if (activity.moving_time_s < minMoving) {
    return {
      eligible: false,
      state: "invalid",
      reason: `moving_time (${activity.moving_time_s}s) is below the minimum plausible ` +
        `threshold (${minMoving}s) for a measured run`,
    };
  }

  if (activity.distance.value_m === 0) {
    return {
      eligible: false,
      state: "invalid",
      reason: "recorded distance is zero for a measured run; treated as a data problem, not a legitimate zero",
    };
  }

  return { eligible: true, state: "valid", reason: null };
}

module.exports = { eligibilityForTrailingRunningDistance };
