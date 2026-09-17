// Activity-level eligibility for trailing_running_hr_zone2_time. Deliberately
// independent of eligibility.js (trailing_running_distance) -- an activity can
// be eligible here while ineligible there, or vice versa. The clearest real
// example found during contract design: activity 90000000001 is a treadmill
// run (is_trainer:true, distance:0 -- INVALID for distance) that has
// has_heartrate:true and a real, if tiny, HR stream -- eligible here.
//
// This function is a cheap STRUCTURAL gate only: does a stream exist, do its
// arrays align, are there enough samples to construct at least one interval.
// It does NOT judge individual samples -- a stream that structurally qualifies
// but is mostly null/invalid HR still passes here and gets its true coverage
// reported via hr-zone-attribution.js's per-interval accounting, not silently
// rejected at this stage.
//
// Returns { eligible, state: "valid"|"missing"|"invalid"|"unsupported"|"retrieval_failed", reason }
function eligibilityForHrZoneTime(activity, hrStream) {
  if (activity.internal_activity_type !== "run") {
    return {
      eligible: false,
      state: "unsupported",
      reason: `sport classified as "${activity.internal_activity_type}", not "run"`,
    };
  }

  if (hrStream?.retrieval_failed) {
    return {
      eligible: false,
      state: "retrieval_failed",
      reason: "HR stream retrieval failed for this activity — distinct from never having HR data at all",
    };
  }

  if (!hrStream || !hrStream.heart_rate_stream_present) {
    return { eligible: false, state: "missing", reason: "heart_rate stream absent from capture" };
  }

  if (!hrStream.samples || hrStream.samples.length < 2) {
    return {
      eligible: false,
      state: "invalid",
      reason: "fewer than 2 samples -- insufficient to construct any time interval",
    };
  }

  return { eligible: true, state: "valid", reason: null };
}

module.exports = { eligibilityForHrZoneTime };
