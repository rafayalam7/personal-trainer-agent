const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalize, resolveLocal } = require("../src/analytics/normalize");
const { adaptCaptures } = require("../src/analytics/adapter");
const { computeTrailingRunningDistance } = require("../src/analytics/metrics/trailing-running-distance");
const config = require("../src/analytics/config");

function loadSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic", name), "utf8"));
}

// Fixed reference instant for every boundary/window test in this file, resolved
// through the same DST-aware function production code uses (config.timezone),
// not a hardcoded offset -- so this test can't silently drift from what
// normalize.js actually does. windowStart = 2026-09-04T21:00:00 America/Chicago
// (168h before WINDOW_END; both instants fall in CDT, no transition crossed).
const WINDOW_END = resolveLocal("2026-09-11T21:00:00", config.timezone).epochMs;

function n(fixtureName, capturedAt = "2026-09-11T00:00:00.000Z") {
  return normalize(loadSynthetic(fixtureName), { captureRef: "test", capturedAt });
}

function run(activities, retrievalStatus = "ok") {
  return computeTrailingRunningDistance({
    activities,
    windowEndEpochMs: WINDOW_END,
    retrievalStatus,
    config,
  });
}

// --- Why these invariants, not a single happy-path total ---
// A single happy-path test ("3 runs sum to 12 miles") only proves the arithmetic
// once, on inputs the author already trusts. Every test below instead targets a
// specific way the pipeline could quietly lie: reordering exposing a hidden
// dependency on array position, duplicates inflating a real number without
// anyone noticing, missing data masquerading as zero, a failed retrieval looking
// identical to "no runs happened." A pure-arithmetic bug is easy to catch by
// inspection; these are the bugs that survive code review and only show up as
// wrong coaching advice months later.

test("input order does not change the result", () => {
  const a = n("valid-outdoor-run.json");
  const b = n("treadmill-invalid-distance.json");
  const r1 = run([a, b]);
  const r2 = run([b, a]);
  assert.deepEqual(r1.result, r2.result);
  assert.deepEqual(r1.coverage, r2.coverage);
});

test("duplicate activity IDs do not increase the total -- most recent capture wins, not array order", () => {
  const earlier = n("duplicate-activity-v1.json", "2026-09-10T00:00:00.000Z"); // distance 4000
  const later = n("duplicate-activity-v2.json", "2026-09-10T12:00:00.000Z"); // distance 4500

  const r1 = run([earlier, later]);
  const r2 = run([later, earlier]); // reversed order -- must not change which one wins

  assert.equal(r1.result.value_m, 4500);
  assert.equal(r2.result.value_m, 4500);
  assert.equal(r1.coverage.recorded_runs_considered, 1); // one activity_id, not two
});

test("invalid distance does not enter the sum", () => {
  const valid = n("valid-outdoor-run.json"); // 5000m
  const treadmill = n("treadmill-invalid-distance.json"); // 3200m, but invalid (moving_time 45s < floor)
  const result = run([valid, treadmill]);
  assert.equal(result.result.value_m, 5000); // treadmill's 3200 must not be added
  assert.equal(result.coverage.runs_included, 1);
  assert.equal(result.coverage.runs_excluded, 1);
  assert.equal(result.exclusions[0].state, "invalid");
  assert.match(result.exclusions[0].reason, /moving_time/); // invalid on evidence, not is_trainer
});

test("a treadmill run with real distance/moving_time evidence now enters the sum -- is_trainer alone no longer excludes it", () => {
  const valid = n("valid-outdoor-run.json"); // 5000m
  const treadmill = n("treadmill-valid-distance.json"); // 3200m, evidence-valid
  const result = run([valid, treadmill]);
  assert.equal(result.result.value_m, 8200); // both included
  assert.equal(result.coverage.runs_included, 2);
  assert.equal(result.coverage.runs_excluded, 0);
  assert.equal(result.coverage.status, "complete");
});

test("missing distance is not converted to zero and is reported as 'missing', distinct from 'invalid'", () => {
  const missing = n("missing-distance.json");
  const result = run([missing]);
  assert.equal(result.result.value_m, 0); // sum over zero eligible runs, not a fallback value
  assert.equal(result.coverage.runs_included, 0);
  assert.equal(result.coverage.runs_excluded, 1);
  assert.equal(result.exclusions[0].state, "missing");
  assert.equal(result.coverage.status, "partial"); // a run WAS considered, just ineligible
});

test("a non-running activity does not contribute and is not counted as an excluded run either", () => {
  const lift = n("non-running-activity.json");
  const validRun = n("valid-outdoor-run.json");
  const result = run([lift, validRun]);
  assert.equal(result.coverage.recorded_runs_considered, 1); // the lift is invisible to this metric
  assert.equal(result.result.value_m, 5000);
  assert.equal(result.exclusions.length, 0);
});

test("window_start is excluded (open) -- half-open (window_start, window_end]", () => {
  const exactlyAtStart = n("run-exactly-at-window-start.json");
  const result = run([exactlyAtStart]);
  assert.equal(result.coverage.recorded_runs_considered, 0);
  assert.equal(result.coverage.status, "empty");
});

test("one second after window_start is included -- pins the open edge to exactly window_start, not nearby", () => {
  const oneSecondAfter = n("run-one-second-after-window-start.json");
  const result = run([oneSecondAfter]);
  assert.equal(result.coverage.recorded_runs_considered, 1);
  assert.equal(result.result.value_m, 1000);
});

test("window_end is included (closed) -- the opposite treatment from window_start, by design", () => {
  const exactlyAtEnd = n("run-exactly-at-window-end.json");
  const result = run([exactlyAtEnd]);
  assert.equal(result.coverage.recorded_runs_considered, 1);
  assert.equal(result.result.value_m, 1000);
});

test("well before window_start is excluded regardless of boundary convention", () => {
  const outside = n("run-just-outside-window-start.json");
  const result = run([outside]);
  assert.equal(result.coverage.recorded_runs_considered, 0);
  assert.equal(result.coverage.status, "empty");
});

test("empty retrieval differs from retrieval failure", () => {
  const emptyCapture = loadSynthetic("empty-successful-retrieval.json");
  const failureCapture = loadSynthetic("retrieval-failure.json");

  const emptyAdapted = adaptCaptures([emptyCapture]);
  const failureAdapted = adaptCaptures([failureCapture]);

  assert.equal(emptyAdapted.retrievalStatus, "ok");
  assert.equal(failureAdapted.retrievalStatus, "failed");

  const emptyResult = run(emptyAdapted.activities, emptyAdapted.retrievalStatus);
  const failureResult = run(failureAdapted.activities, failureAdapted.retrievalStatus);

  assert.equal(emptyResult.coverage.status, "empty");
  assert.equal(emptyResult.result.value_m, 0);

  assert.equal(failureResult.coverage.status, "retrieval_failed");
  assert.equal(failureResult.result.value_m, null); // null, never 0 -- "unknown" is not "zero"
});

test("partial coverage stays labeled partial -- a subtotal is never presented as complete", () => {
  const valid = n("valid-outdoor-run.json");
  const missing = n("missing-distance.json");
  const result = run([valid, missing]);
  assert.equal(result.coverage.status, "partial");
  assert.equal(result.result.value_m, 5000); // real subtotal
  assert.notEqual(result.coverage.status, "complete"); // must never be mislabeled
});

test("complete coverage only when every considered run is eligible", () => {
  const a = n("valid-outdoor-run.json");
  const result = run([a]);
  assert.equal(result.coverage.status, "complete");
});

test("the same captured input and config reproduce the same result", () => {
  const activities = [n("valid-outdoor-run.json"), n("treadmill-invalid-distance.json")];
  const r1 = run(activities);
  const r2 = run(activities);
  // Everything except the wall-clock computed_at timestamp must match exactly.
  assert.deepEqual(r1.result, r2.result);
  assert.deepEqual(r1.coverage, r2.coverage);
  assert.deepEqual(r1.exclusions, r2.exclusions);
  assert.deepEqual(r1.window, r2.window);
});
