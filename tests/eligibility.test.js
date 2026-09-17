const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { eligibilityForTrailingRunningDistance } = require("../src/analytics/eligibility");
const { normalize } = require("../src/analytics/normalize");
const config = require("../src/analytics/config");

function loadReal(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "real", name), "utf8"));
  return normalize(raw, { captureRef: "test", capturedAt: "2026-09-17T00:00:00.000Z" });
}

function activity(overrides) {
  return {
    internal_activity_type: "run",
    is_trainer: false,
    distance: { value_m: 5000 },
    moving_time_s: 1800,
    ...overrides,
  };
}

test("non-run sport is unsupported, regardless of otherwise-valid fields", () => {
  const v = eligibilityForTrailingRunningDistance(activity({ internal_activity_type: "lift" }), config);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "unsupported");
});

test("missing distance field is 'missing', not zero", () => {
  const v = eligibilityForTrailingRunningDistance(activity({ distance: { value_m: null } }), config);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "missing");
});

test("moving_time below the configured floor is invalid", () => {
  const v = eligibilityForTrailingRunningDistance(activity({ moving_time_s: 8 }), config);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "invalid");
  assert.match(v.reason, /moving_time/);
});

test("zero distance on an otherwise-plausible run is invalid, never legitimate_zero", () => {
  const v = eligibilityForTrailingRunningDistance(
    activity({ distance: { value_m: 0 }, moving_time_s: 600 }),
    config
  );
  assert.equal(v.eligible, false);
  assert.equal(v.state, "invalid");
});

test("a run passing every check is eligible", () => {
  const v = eligibilityForTrailingRunningDistance(activity({}), config);
  assert.equal(v.eligible, true);
  assert.equal(v.state, "valid");
  assert.equal(v.reason, null);
});

test("the same activity shape can be eligible for this metric while a hypothetical pace metric would need the distance stream, not summary distance -- eligibility is metric-specific, this function only ever answers for trailing_running_distance", () => {
  const v = eligibilityForTrailingRunningDistance(activity({}), config);
  assert.equal(v.eligible, true); // proven eligible here using only summary.distance
  // A future pace metric's eligibility function would check the distance STREAM
  // instead, and could reach a different verdict on this exact same activity --
  // by design, not by accident. Nothing here computes or reads a stream at all.
});

// --- Real fixtures: label-independence proven on genuine historical evidence ---

test("real old broken treadmill run (distance:0, moving_time:2) stays excluded, via moving_time, not is_trainer", () => {
  const n = loadReal("treadmill-run-invalid.json");
  const v = eligibilityForTrailingRunningDistance(n, config);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "invalid");
  assert.match(v.reason, /moving_time/);
  assert.doesNotMatch(v.reason, /is_trainer|treadmill|trainer/i);
});

test("real new Technogym treadmill run (real distance/moving_time) is now eligible", () => {
  const n = loadReal("treadmill-run-valid.json");
  const v = eligibilityForTrailingRunningDistance(n, config);
  assert.equal(v.eligible, true);
  assert.equal(v.state, "valid");
  assert.equal(v.reason, null);
});

test("real corrupted outdoor run (GPS failure) stays excluded", () => {
  const n = loadReal("outdoor-run-corrupted-summary.json");
  const v = eligibilityForTrailingRunningDistance(n, config);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "invalid");
  assert.match(v.reason, /moving_time/);
});

test("real valid outdoor run stays eligible", () => {
  const n = loadReal("outdoor-run-valid.json");
  const v = eligibilityForTrailingRunningDistance(n, config);
  assert.equal(v.eligible, true);
  assert.equal(v.state, "valid");
});

// --- Label independence: is_trainer alone must never decide the verdict ---

test("an evidence-valid run is eligible regardless of is_trainer (false, true, or unknown)", () => {
  for (const is_trainer of [false, true, null]) {
    const v = eligibilityForTrailingRunningDistance(activity({ is_trainer }), config);
    assert.equal(v.eligible, true, `expected eligible for is_trainer=${is_trainer}`);
    assert.equal(v.state, "valid");
  }
});

test("an evidence-invalid run (moving_time below floor) stays excluded for the same reason regardless of is_trainer -- the label cannot rescue it", () => {
  for (const is_trainer of [false, true, null]) {
    const v = eligibilityForTrailingRunningDistance(activity({ is_trainer, moving_time_s: 8 }), config);
    assert.equal(v.eligible, false, `expected excluded for is_trainer=${is_trainer}`);
    assert.equal(v.state, "invalid");
    assert.match(v.reason, /moving_time/);
  }
});
