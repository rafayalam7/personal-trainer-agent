// Pure transform: raw get_activity_streams response -> normalized HR stream.
// Normalization preserves observations; it makes NO validity judgment. That
// judgment belongs entirely to eligibility-hr-zone.js (activity-level) and
// hr-zone-attribution.js (interval-level) -- see CONTRACT-hr-zone2-time.md.
//
// Critically: this does NOT filter out null/invalid HR samples, and it does not
// collapse "missing" and "invalid" into one sentinel. `hr` is preserved exactly
// as Strava returned it at that index -- a finite number, an explicit `null`,
// or (rarely) something else non-numeric. time, heart_rate, and moving stay
// index-aligned, length-for-length. Classifying what a given `hr` value means
// (missing vs. invalid vs. usable) is hr-zone-attribution.js's job, not this one's.
function normalizeHeartRateStream(rawStreams, meta) {
  const time = Array.isArray(rawStreams?.time) ? rawStreams.time : null;
  const heartRate = Array.isArray(rawStreams?.heart_rate) ? rawStreams.heart_rate : null;
  const moving = Array.isArray(rawStreams?.moving) ? rawStreams.moving : null;

  if (!time) {
    return {
      source_activity_id: String(meta.activityId),
      samples: null,
      heart_rate_stream_present: false,
      moving_stream_present: false,
      capture_ref: meta.captureRef,
      captured_at: meta.capturedAt,
    };
  }

  const samples = time.map((t, i) => ({
    t,
    hr: heartRate ? (heartRate[i] === undefined ? null : heartRate[i]) : null,
    moving: moving ? (moving[i] === undefined ? null : moving[i]) : null,
  }));

  return {
    source_activity_id: String(meta.activityId),
    samples,
    // Distinguishes "the heart_rate key was absent from the response entirely"
    // (an activity-level eligibility concern) from "the key exists but some/all
    // per-sample values are null" (an interval-level accounting concern) --
    // these are different findings and must not be inferred from each other.
    heart_rate_stream_present: heartRate !== null,
    moving_stream_present: moving !== null,
    capture_ref: meta.captureRef,
    captured_at: meta.capturedAt,
  };
}

module.exports = { normalizeHeartRateStream };
