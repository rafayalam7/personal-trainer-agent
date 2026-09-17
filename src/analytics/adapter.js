// I/O boundary for Phase 7. readCaptureFile touches the filesystem; adaptCaptures
// is pure and takes already-parsed capture objects, so tests never need real files.
//
// Deliberately explicit rather than clever: the caller (a Weekly Review run) must
// name exactly which capture files fed a calculation — this function never scans a
// directory on its own. That keeps provenance and reproducibility unambiguous:
// "this result came from these specific capture files," not "whatever happened to
// be in state/.raw-capture/ at the time."
const fs = require("fs");
const { normalize } = require("./normalize");
const { normalizeHeartRateStream } = require("./normalize-hr-stream");
const { normalizeZoneConfig } = require("./normalize-zone-config");

function readCaptureFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {object[]} captureObjects - parsed contents of one or more
 *   state/.raw-capture/*.json files, as written by .claude/hooks/capture-strava.js
 * @returns {{ retrievalStatus: "ok"|"failed", activities: object[] }}
 */
function adaptCaptures(captureObjects) {
  let retrievalStatus = "ok";
  const activities = [];
  // Completeness proof, not an assumption: real evidence (this session) showed
  // a `first: 30` capture with has_next_page:true was silently treated as the
  // whole activity list before this check existed. list_activities is
  // cursor-paginated; a page's own has_next_page is the only honest signal
  // that pagination actually reached its end. If no provided capture has
  // has_next_page:false, we do not know we saw everything, regardless of how
  // many activities we did see — see RETRIEVAL.md "Retrieval completeness."
  let sawTerminalPage = false;

  for (const capture of captureObjects) {
    if (capture.status !== "ok") {
      // retrieval_failed or capture_failed_unrecognized_format — either way we
      // cannot trust this batch is complete, so the whole retrieval is tainted.
      retrievalStatus = "failed";
      continue;
    }
    const list = capture.parsed?.activities;
    if (!Array.isArray(list)) {
      retrievalStatus = "failed";
      continue;
    }
    if (capture.parsed?.has_next_page === false) {
      sawTerminalPage = true;
    }
    for (const rawActivity of list) {
      activities.push(
        normalize(rawActivity, {
          captureRef: `${capture.tool_name}`,
          capturedAt: capture.captured_at,
        })
      );
    }
  }

  if (retrievalStatus === "ok" && !sawTerminalPage) {
    // Every provided page still claims more exist (or has_next_page was
    // absent/malformed) — pagination was never confirmed complete. This is
    // deliberately conservative: it assumes captures were gathered via correct
    // sequential pagination (each `after` derived from the prior response's
    // own end_cursor), since that's the only way a valid cursor can exist at
    // all under normal orchestration.
    retrievalStatus = "failed";
  }

  if (retrievalStatus === "failed") {
    return { retrievalStatus: "failed", activities: [] };
  }
  return { retrievalStatus: "ok", activities };
}

/**
 * get_activity_streams captures are per-ACTIVITY, unlike list_activities'
 * per-batch captures -- so a single stream-retrieval failure only excludes
 * that one activity from the HR-zone metric, it does NOT taint the whole
 * result the way a failed activity-LIST retrieval does. See
 * CONTRACT-hr-zone2-time.md and eligibility-hr-zone.js's "retrieval_failed"
 * per-activity state.
 *
 * @param {object[]} captureObjects - parsed get_activity_streams captures
 * @returns {Map<string, object>} source_activity_id -> normalized HR stream,
 *   or { retrieval_failed: true } if that activity's stream capture failed
 */
function adaptHrStreamCaptures(captureObjects) {
  const hrStreamsByActivityId = new Map();
  for (const capture of captureObjects) {
    const activityId = capture.tool_input?.activity_id;
    if (!activityId) continue; // can't attribute to any activity; nothing sane to store
    if (capture.status !== "ok") {
      hrStreamsByActivityId.set(String(activityId), { retrieval_failed: true });
      continue;
    }
    hrStreamsByActivityId.set(
      String(activityId),
      normalizeHeartRateStream(capture.parsed, {
        activityId,
        captureRef: capture.tool_name,
        capturedAt: capture.captured_at,
      })
    );
  }
  return hrStreamsByActivityId;
}

/**
 * get_athlete_zones is a single, whole-metric-scoped capture -- unlike stream
 * captures, its failure genuinely means "we don't know the configuration at
 * all," which is a real retrieval failure (distinct from a successfully
 * retrieved but malformed Zone 2 -- see normalize-zone-config.js's `valid`
 * flag and CONTRACT-hr-zone2-time.md "Zone-config failure semantics").
 *
 * @returns {{ retrievalStatus: "ok"|"failed", zoneConfig: object|null }}
 */
function adaptZoneConfigCapture(captureObject, config) {
  if (!captureObject || captureObject.status !== "ok") {
    return { retrievalStatus: "failed", zoneConfig: null };
  }
  return {
    retrievalStatus: "ok",
    zoneConfig: normalizeZoneConfig(
      captureObject.parsed,
      { captureRef: captureObject.tool_name, capturedAt: captureObject.captured_at },
      config
    ),
  };
}

module.exports = { readCaptureFile, adaptCaptures, adaptHrStreamCaptures, adaptZoneConfigCapture };
