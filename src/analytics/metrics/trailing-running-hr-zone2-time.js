// Pure calculation. No MCP calls, no filesystem, no coaching Markdown, no
// carry-forward writes, no mutation of its inputs -- same discipline as
// trailing-running-distance.js. Eligibility here is independent of that
// metric's: a treadmill run invalid for distance can be valid here.
const { filterToWindow, dedupeByActivityId } = require("../window");
const { eligibilityForHrZoneTime } = require("../eligibility-hr-zone");
const { attributeRunHrTime } = require("../hr-zone-attribution");

/**
 * @param {object[]} activities - normalized activities (see normalize.js)
 * @param {Map<string, object>} hrStreamsByActivityId - source_activity_id -> normalized HR stream (see normalize-hr-stream.js); absent entries are treated as "no stream captured"
 * @param {{ valid: boolean, zone2: {min:number,max:number|null}|null, source: string|null, capture_ref: string|null, captured_at: string|null }} zoneConfig
 * @param {number} windowEndEpochMs - explicit reference instant; never "now" inside this function
 * @param {"ok"|"failed"} retrievalStatus - activity-list/stream retrieval status (NOT zone config status -- that's zoneConfig.valid)
 * @param {object} config
 */
function computeTrailingRunningHrZone2Time({
  activities,
  hrStreamsByActivityId,
  zoneConfig,
  windowEndEpochMs,
  retrievalStatus,
  config,
}) {
  const windowHours = config.heartRateZoneTime.windowHours;
  const windowStartEpochMs = windowEndEpochMs - windowHours * 3600 * 1000;
  const computedAt = new Date().toISOString();

  const baseResult = {
    metric: "trailing_running_hr_zone2_time",
    metric_version: config.heartRateZoneTime.metricVersion,
    window: { start_epoch_ms: windowStartEpochMs, end_epoch_ms: windowEndEpochMs, hours: windowHours },
    zone_config: {
      zone2: zoneConfig?.zone2 ?? null,
      source: zoneConfig?.source ?? null,
      capture_ref: zoneConfig?.capture_ref ?? null,
      captured_at: zoneConfig?.captured_at ?? null,
    },
    provenance: {
      source: "strava",
      schema_version: config.schemaVersion,
      computed_at: computedAt,
    },
  };

  const emptyCoverage = {
    recorded_runs_considered: null,
    runs_with_usable_hr: null,
    runs_excluded: null,
    total_represented_seconds: null,
  };

  if (retrievalStatus === "failed") {
    return {
      ...baseResult,
      result: { zone2_seconds: null, unit: "seconds" },
      coverage: { status: "retrieval_failed", ...emptyCoverage },
      exclusions: [],
      partial_coverage: [],
    };
  }

  // Zone config unusable is NOT the same as retrieval failing -- retrieval
  // succeeded, the configuration itself just doesn't support this metric. See
  // CONTRACT-hr-zone2-time.md "Zone-config failure semantics."
  if (!zoneConfig || !zoneConfig.valid) {
    return {
      ...baseResult,
      result: { zone2_seconds: null, unit: "seconds" },
      coverage: { status: "config_invalid", ...emptyCoverage },
      exclusions: [],
      partial_coverage: [],
    };
  }

  const runsInWindow = filterToWindow(activities, {
    windowStartEpochMs,
    windowEndEpochMs,
    activityType: "run",
  });
  const dedupedRuns = dedupeByActivityId(runsInWindow);

  let totalZone2Seconds = 0;
  let totalRepresentedSeconds = 0;
  let runsWithUsableHr = 0;
  const exclusions = [];
  const partialCoverage = [];

  for (const activity of dedupedRuns) {
    const hrStream = hrStreamsByActivityId.get(activity.source_activity_id);
    const verdict = eligibilityForHrZoneTime(activity, hrStream);

    if (!verdict.eligible) {
      exclusions.push({
        activity_id: activity.source_activity_id,
        state: verdict.state,
        reason: verdict.reason,
      });
      continue;
    }

    runsWithUsableHr += 1;
    const attribution = attributeRunHrTime(hrStream.samples, zoneConfig.zone2, config);
    totalZone2Seconds += attribution.zone2_seconds;
    totalRepresentedSeconds += attribution.total_represented_seconds;

    if (attribution.unrepresented_seconds > 0) {
      partialCoverage.push({
        activity_id: activity.source_activity_id,
        unrepresented_seconds: attribution.unrepresented_seconds,
        unrepresented_breakdown: attribution.unrepresented_breakdown,
      });
    }
  }

  const recordedRunsConsidered = dedupedRuns.length;
  const runsExcluded = exclusions.length;

  let status;
  if (recordedRunsConsidered === 0) {
    status = "empty";
  } else if (runsExcluded === 0 && partialCoverage.length === 0) {
    status = "complete";
  } else {
    status = "partial";
  }

  return {
    ...baseResult,
    result: { zone2_seconds: totalZone2Seconds, unit: "seconds" },
    coverage: {
      status,
      recorded_runs_considered: recordedRunsConsidered,
      runs_with_usable_hr: runsWithUsableHr,
      runs_excluded: runsExcluded,
      total_represented_seconds: totalRepresentedSeconds,
    },
    exclusions,
    partial_coverage: partialCoverage,
  };
}

module.exports = { computeTrailingRunningHrZone2Time };
