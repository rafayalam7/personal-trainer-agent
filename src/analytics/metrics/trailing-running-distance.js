// Pure calculation. No MCP calls, no filesystem, no coaching Markdown, no
// carry-forward writes, no mutation of its inputs. Given the same normalized
// activities, window, and config, it always returns the same result.
const { eligibilityForTrailingRunningDistance } = require("../eligibility");
const { filterToWindow, dedupeByActivityId } = require("../window");

/**
 * @param {object[]} activities - normalized activities (see normalize.js), may
 *   contain duplicate source_activity_id entries from repeated captures.
 * @param {number} windowEndEpochMs - explicit reference instant; never read
 *   from "now" inside this function.
 * @param {"ok"|"failed"} retrievalStatus - from adapter.adaptCaptures()
 * @param {object} config
 */
function computeTrailingRunningDistance({ activities, windowEndEpochMs, retrievalStatus, config }) {
  const windowHours = config.trailingRunningDistance.windowHours;
  const windowStartEpochMs = windowEndEpochMs - windowHours * 3600 * 1000;
  const computedAt = new Date().toISOString();

  const baseResult = {
    metric: "trailing_running_distance",
    metric_version: config.trailingRunningDistance.metricVersion,
    window: {
      start_epoch_ms: windowStartEpochMs,
      end_epoch_ms: windowEndEpochMs,
      hours: windowHours,
    },
    provenance: {
      source: "strava",
      schema_version: config.schemaVersion,
      computed_at: computedAt,
    },
  };

  if (retrievalStatus === "failed") {
    return {
      ...baseResult,
      result: { value_m: null, unit: "meters" },
      coverage: {
        status: "retrieval_failed",
        recorded_runs_considered: null,
        runs_included: null,
        runs_excluded: null,
      },
      exclusions: [],
    };
  }

  // Window membership + dedup: shared with every other Phase 7 metric via
  // window.js -- this is what actually enforces "no second meaning of 168
  // hours," not just the comment. See CONTRACT-trailing-running-distance.md
  // "Window boundary convention" for the half-open reasoning.
  const runsInWindow = filterToWindow(activities, {
    windowStartEpochMs,
    windowEndEpochMs,
    activityType: "run",
  });
  const dedupedRuns = dedupeByActivityId(runsInWindow);

  let totalMeters = 0;
  let runsIncluded = 0;
  const exclusions = [];

  for (const activity of dedupedRuns) {
    const verdict = eligibilityForTrailingRunningDistance(activity, config);
    if (verdict.eligible) {
      totalMeters += activity.distance.value_m;
      runsIncluded += 1;
    } else {
      exclusions.push({
        activity_id: activity.source_activity_id,
        state: verdict.state,
        reason: verdict.reason,
      });
    }
  }

  const recordedRunsConsidered = dedupedRuns.length;
  const runsExcluded = exclusions.length;

  let status;
  if (recordedRunsConsidered === 0) {
    status = "empty";
  } else if (runsExcluded === 0) {
    status = "complete";
  } else {
    status = "partial";
  }

  return {
    ...baseResult,
    result: { value_m: totalMeters, unit: "meters" },
    coverage: {
      status,
      recorded_runs_considered: recordedRunsConsidered,
      runs_included: runsIncluded,
      runs_excluded: runsExcluded,
    },
    exclusions,
  };
}

module.exports = { computeTrailingRunningDistance };
