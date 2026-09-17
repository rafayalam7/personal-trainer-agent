// Interval-level classification and per-run reduction. This is where every
// second of a run's HR stream gets audited into exactly one bucket -- see
// CONTRACT-hr-zone2-time.md "Interval attribution" for the precedence order
// this implements verbatim.
//
// Forward attribution: sample i governs the interval [time[i], time[i+1]).
// The last sample contributes zero -- there's no next instant to bound it.

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function inZone2(hr, zone2) {
  if (zone2.max === null) return hr >= zone2.min;
  return hr >= zone2.min && hr <= zone2.max;
}

// Classifies one interval. Returns { bucket, reason } where bucket is one of
// "zone2" | "other_zone" | "non_moving" | "unrepresented", and reason is set
// only for "unrepresented".
function classifyInterval({ hr, moving, gapSeconds }, zone2, config) {
  if (moving === null || moving === undefined) {
    return { bucket: "unrepresented", reason: "missing_moving_seconds" };
  }
  if (moving === false) {
    return { bucket: "non_moving", reason: null };
  }
  // moving === true from here on.
  if (hr === null || hr === undefined) {
    return { bucket: "unrepresented", reason: "missing_hr_seconds" };
  }
  if (!isFiniteNumber(hr)) {
    return { bucket: "unrepresented", reason: "invalid_hr_seconds" };
  }
  // hr is a usable finite number. Gap capping happens at the reducer level
  // (attributeRunHrTime) since it needs to split one interval's duration
  // across two buckets; this function reports which zone the USABLE portion
  // belongs to.
  return { bucket: inZone2(hr, zone2) ? "zone2" : "other_zone", reason: null };
}

/**
 * @param {{t:number, hr:number|null, moving:boolean|null}[]} samples
 * @param {{min:number, max:number|null}} zone2
 * @param {object} config
 * @returns {{
 *   zone2_seconds, other_zone_seconds, non_moving_seconds, unrepresented_seconds,
 *   unrepresented_breakdown: {missing_moving_seconds, missing_hr_seconds, invalid_hr_seconds, large_gap_seconds},
 *   total_represented_seconds
 * }}
 */
function attributeRunHrTime(samples, zone2, config) {
  const totals = {
    zone2_seconds: 0,
    other_zone_seconds: 0,
    non_moving_seconds: 0,
    unrepresented_seconds: 0,
  };
  const breakdown = {
    missing_moving_seconds: 0,
    missing_hr_seconds: 0,
    invalid_hr_seconds: 0,
    large_gap_seconds: 0,
  };

  const maxGap = config.heartRateZoneTime.maxGapSeconds;

  for (let i = 0; i < samples.length - 1; i++) {
    const gapSeconds = samples[i + 1].t - samples[i].t;
    const { bucket, reason } = classifyInterval(
      { hr: samples[i].hr, moving: samples[i].moving, gapSeconds },
      zone2,
      config
    );

    if (bucket === "zone2" || bucket === "other_zone") {
      if (gapSeconds <= maxGap) {
        totals[`${bucket}_seconds`] += gapSeconds;
      } else {
        // Cap the usable portion to the zone bucket; the excess is an
        // explicit, separately-labeled exclusion -- never silently zoned.
        totals[`${bucket}_seconds`] += maxGap;
        const excess = gapSeconds - maxGap;
        totals.unrepresented_seconds += excess;
        breakdown.large_gap_seconds += excess;
      }
    } else if (bucket === "non_moving") {
      totals.non_moving_seconds += gapSeconds;
    } else {
      // unrepresented for a reason other than a gap (missing_moving/missing_hr/invalid_hr)
      totals.unrepresented_seconds += gapSeconds;
      breakdown[reason] += gapSeconds;
    }
  }

  const totalRepresented =
    samples.length > 0 ? samples[samples.length - 1].t - samples[0].t : 0;

  return {
    ...totals,
    unrepresented_breakdown: breakdown,
    total_represented_seconds: totalRepresented,
  };
}

module.exports = { classifyInterval, attributeRunHrTime, inZone2 };
