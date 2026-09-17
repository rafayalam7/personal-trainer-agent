const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalize, resolveLocal } = require("../src/analytics/normalize");
const { normalizeHeartRateStream } = require("../src/analytics/normalize-hr-stream");
const { normalizeZoneConfig } = require("../src/analytics/normalize-zone-config");
const { computeTrailingRunningHrZone2Time } = require("../src/analytics/metrics/trailing-running-hr-zone2-time");
const config = require("../src/analytics/config");

const WINDOW_END = resolveLocal("2026-09-11T21:00:00", config.timezone).epochMs;

function loadDistanceSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic", name), "utf8"));
}
function loadHrSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "synthetic", name), "utf8"));
}
function loadHrReal(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "real", name), "utf8"));
}

function activityFrom(distanceFixtureName, capturedAt = "2026-09-11T00:00:00.000Z") {
  return normalize(loadDistanceSynthetic(distanceFixtureName), { captureRef: "test", capturedAt });
}
function hrStreamFrom(hrFixtureName, activityId) {
  return normalizeHeartRateStream(loadHrSynthetic(hrFixtureName), { activityId, captureRef: "test", capturedAt: "2026-09-11T00:00:00.000Z" });
}

const VALID_ZONE_CONFIG = normalizeZoneConfig(loadHrReal("zone-config.json"), { captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" }, config);
const INVALID_ZONE_CONFIG = normalizeZoneConfig(loadHrSynthetic("malformed-zone-config.json"), { captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" }, config);

function run({ activities, hrStreamsByActivityId, zoneConfig = VALID_ZONE_CONFIG, retrievalStatus = "ok" }) {
  return computeTrailingRunningHrZone2Time({
    activities,
    hrStreamsByActivityId,
    zoneConfig,
    windowEndEpochMs: WINDOW_END,
    retrievalStatus,
    config,
  });
}

test("malformed zone config (successful retrieval, unusable Zone 2) -> config_invalid, distinct from retrieval_failed", () => {
  assert.equal(VALID_ZONE_CONFIG.valid, true);
  assert.equal(INVALID_ZONE_CONFIG.valid, false);

  const activity = activityFrom("valid-outdoor-run.json");
  const hrMap = new Map([[activity.source_activity_id, hrStreamFrom("continuous-zone2.json", activity.source_activity_id)]]);

  const result = run({ activities: [activity], hrStreamsByActivityId: hrMap, zoneConfig: INVALID_ZONE_CONFIG });
  assert.equal(result.coverage.status, "config_invalid");
  assert.equal(result.result.zone2_seconds, null); // unknown, never 0
});

test("activity-list retrieval failure -> retrieval_failed, distinct from config_invalid", () => {
  const result = run({ activities: [], hrStreamsByActivityId: new Map(), retrievalStatus: "failed" });
  assert.equal(result.coverage.status, "retrieval_failed");
  assert.equal(result.result.zone2_seconds, null);
});

test("empty window (no runs) -> empty, not retrieval_failed and not config_invalid", () => {
  const result = run({ activities: [], hrStreamsByActivityId: new Map() });
  assert.equal(result.coverage.status, "empty");
  assert.equal(result.result.zone2_seconds, 0);
});

test("a treadmill run invalid for trailing_running_distance is ELIGIBLE here -- the core architectural proof", () => {
  const treadmill = activityFrom("treadmill-invalid-distance.json"); // is_trainer:true, distance:0
  const hrMap = new Map([[treadmill.source_activity_id, hrStreamFrom("continuous-zone2.json", treadmill.source_activity_id)]]);
  const result = run({ activities: [treadmill], hrStreamsByActivityId: hrMap });
  assert.equal(result.coverage.status, "complete");
  assert.equal(result.coverage.runs_excluded, 0);
  assert.equal(result.result.zone2_seconds, 3); // continuous-zone2.json's hand-derived total
});

test("a run with a failed HR-stream retrieval is excluded with state 'retrieval_failed', not 'missing'", () => {
  const activity = activityFrom("valid-outdoor-run.json");
  const hrMap = new Map([[activity.source_activity_id, { retrieval_failed: true }]]);
  const result = run({ activities: [activity], hrStreamsByActivityId: hrMap });
  assert.equal(result.coverage.status, "partial");
  assert.equal(result.exclusions[0].state, "retrieval_failed");
});

test("a run entirely outside the window is not considered at all", () => {
  const outside = activityFrom("run-just-outside-window-start.json");
  const hrMap = new Map([[outside.source_activity_id, hrStreamFrom("continuous-zone2.json", outside.source_activity_id)]]);
  const result = run({ activities: [outside], hrStreamsByActivityId: hrMap });
  assert.equal(result.coverage.status, "empty");
  assert.equal(result.coverage.recorded_runs_considered, 0);
});

test("duplicate activity retrieval does not double-count Zone 2 seconds -- shared dedup from window.js", () => {
  const earlier = activityFrom("duplicate-activity-v1.json", "2026-09-10T00:00:00.000Z");
  const later = activityFrom("duplicate-activity-v2.json", "2026-09-10T12:00:00.000Z");
  const hrMap = new Map([
    [earlier.source_activity_id, hrStreamFrom("continuous-zone2.json", earlier.source_activity_id)],
  ]);
  const r1 = run({ activities: [earlier, later], hrStreamsByActivityId: hrMap });
  const r2 = run({ activities: [later, earlier], hrStreamsByActivityId: hrMap }); // reversed order
  assert.equal(r1.coverage.recorded_runs_considered, 1);
  assert.deepEqual(r1.result, r2.result);
  assert.deepEqual(r1.coverage, r2.coverage);
});

test("a partially-gapped run appears in partial_coverage, not exclusions -- it contributed real zone2 time", () => {
  const activity = activityFrom("valid-outdoor-run.json");
  const hrMap = new Map([[activity.source_activity_id, hrStreamFrom("partial-coverage-mixed.json", activity.source_activity_id)]]);
  const result = run({ activities: [activity], hrStreamsByActivityId: hrMap });
  assert.equal(result.coverage.status, "partial");
  assert.equal(result.exclusions.length, 0);
  assert.equal(result.partial_coverage.length, 1);
  assert.equal(result.partial_coverage[0].unrepresented_seconds, 2);
  assert.equal(result.result.zone2_seconds, 32);
});

test("input order does not change the result", () => {
  const a = activityFrom("valid-outdoor-run.json");
  const treadmill = activityFrom("treadmill-invalid-distance.json");
  const hrMap = new Map([
    [a.source_activity_id, hrStreamFrom("continuous-zone2.json", a.source_activity_id)],
    [treadmill.source_activity_id, hrStreamFrom("multizone-crossing.json", treadmill.source_activity_id)],
  ]);
  const r1 = run({ activities: [a, treadmill], hrStreamsByActivityId: hrMap });
  const r2 = run({ activities: [treadmill, a], hrStreamsByActivityId: hrMap });
  assert.deepEqual(r1.result, r2.result);
  assert.deepEqual(r1.coverage, r2.coverage);
});

test("identical captured input, config, and metric version reproduce the same result", () => {
  const activity = activityFrom("valid-outdoor-run.json");
  const hrMap = new Map([[activity.source_activity_id, hrStreamFrom("multizone-crossing.json", activity.source_activity_id)]]);
  const r1 = run({ activities: [activity], hrStreamsByActivityId: hrMap });
  const r2 = run({ activities: [activity], hrStreamsByActivityId: hrMap });
  assert.deepEqual(r1.result, r2.result);
  assert.deepEqual(r1.coverage, r2.coverage);
  assert.deepEqual(r1.partial_coverage, r2.partial_coverage);
});

test("changing the zone configuration deterministically changes the result", () => {
  const activity = activityFrom("valid-outdoor-run.json");
  const hrMap = new Map([[activity.source_activity_id, hrStreamFrom("multizone-crossing.json", activity.source_activity_id)]]);
  const withRealZones = run({ activities: [activity], hrStreamsByActivityId: hrMap, zoneConfig: VALID_ZONE_CONFIG });

  // A hypothetical wider Zone 2 (e.g. a different athlete/config) changes which
  // intervals count -- this must show up in the result, not be silently ignored.
  const widerZone2 = normalizeZoneConfig(
    { heart_rate_zones: [{ min: 0, max: 100 }, { min: 101, max: 200 }], heart_rate_zone_source: "MaxHeartRate" },
    { captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" },
    config
  );
  const withWiderZones = run({ activities: [activity], hrStreamsByActivityId: hrMap, zoneConfig: widerZone2 });

  assert.notEqual(withRealZones.result.zone2_seconds, withWiderZones.result.zone2_seconds);
  assert.equal(withWiderZones.result.zone2_seconds, 4); // all 4 seconds of multizone-crossing.json now fall in [101,200]
});
