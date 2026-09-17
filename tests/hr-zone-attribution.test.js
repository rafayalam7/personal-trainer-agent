const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalizeHeartRateStream } = require("../src/analytics/normalize-hr-stream");
const { attributeRunHrTime } = require("../src/analytics/hr-zone-attribution");
const config = require("../src/analytics/config");

const ZONE2 = { min: 132, max: 163 };

function loadSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "synthetic", name), "utf8"));
}
function loadReal(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "real", name), "utf8"));
}

function attribute(raw) {
  const stream = normalizeHeartRateStream(raw, { activityId: "test", captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" });
  return attributeRunHrTime(stream.samples, ZONE2, config);
}

// Every test here checks the invariant explicitly, not just the headline
// number -- this is the whole point of the bucketed design.
function assertInvariant(a) {
  const sum = a.zone2_seconds + a.other_zone_seconds + a.non_moving_seconds + a.unrepresented_seconds;
  assert.equal(sum, a.total_represented_seconds);
  const breakdownSum =
    a.unrepresented_breakdown.missing_moving_seconds +
    a.unrepresented_breakdown.missing_hr_seconds +
    a.unrepresented_breakdown.invalid_hr_seconds +
    a.unrepresented_breakdown.large_gap_seconds;
  assert.equal(breakdownSum, a.unrepresented_seconds);
}

test("continuous Zone 2 -- all time attributed to zone2, hand-derived: 3s", () => {
  const a = attribute(loadSynthetic("continuous-zone2.json"));
  assert.equal(a.zone2_seconds, 3);
  assert.equal(a.other_zone_seconds, 0);
  assert.equal(a.total_represented_seconds, 3);
  assertInvariant(a);
});

test("multi-zone crossing -- hand-derived: zone2=2s, other_zone=2s", () => {
  const a = attribute(loadSynthetic("multizone-crossing.json"));
  assert.equal(a.zone2_seconds, 2);
  assert.equal(a.other_zone_seconds, 2);
  assert.equal(a.total_represented_seconds, 4);
  assertInvariant(a);
});

test("HR=132 (Zone 2 lower boundary, inclusive) counts as zone2", () => {
  const a = attribute(loadSynthetic("hr-boundary-lower.json"));
  assert.equal(a.zone2_seconds, 1);
  assert.equal(a.other_zone_seconds, 0);
});

test("HR=163 (Zone 2 upper boundary, inclusive) counts as zone2, not zone 3", () => {
  const a = attribute(loadSynthetic("hr-boundary-upper.json"));
  assert.equal(a.zone2_seconds, 1);
  assert.equal(a.other_zone_seconds, 0);
});

test("HR=131 and HR=164 (just outside both edges) both land in other_zone", () => {
  const a = attribute(loadSynthetic("hr-boundary-just-outside.json"));
  assert.equal(a.zone2_seconds, 0);
  assert.equal(a.other_zone_seconds, 2);
});

test("irregular sample spacing is time-weighted correctly, not counted per-sample -- hand-derived: 2+3+4+5=14s", () => {
  const a = attribute(loadSynthetic("irregular-spacing.json"));
  assert.equal(a.zone2_seconds, 14);
  assert.equal(a.total_represented_seconds, 14);
  assertInvariant(a);
});

test("a large gap (310s) is capped at maxGapSeconds, excess is explicitly unrepresented -- never silently zoned", () => {
  const a = attribute(loadSynthetic("large-gap.json"));
  assert.equal(a.zone2_seconds, 31); // 30 capped + 1 from the second interval
  assert.equal(a.unrepresented_breakdown.large_gap_seconds, 280);
  assert.equal(a.total_represented_seconds, 311);
  assertInvariant(a);
  // Sanity: a naive "attribute the whole gap" implementation would give 341
  // (30+1+310), not 311 -- this is exactly the bug this design prevents.
  assert.notEqual(a.zone2_seconds + a.unrepresented_seconds, 341);
});

test("null HR alignment -- moving:false takes precedence over a null HR at the same index (not classified as missing_hr)", () => {
  const a = attribute(loadSynthetic("null-hr-alignment.json"));
  assert.equal(a.zone2_seconds, 1);
  assert.equal(a.non_moving_seconds, 1);
  assert.equal(a.unrepresented_seconds, 0);
  assert.equal(a.unrepresented_breakdown.missing_hr_seconds, 0); // the null never gets classified as missing_hr
  assert.equal(a.total_represented_seconds, 2);
  assertInvariant(a);
});

test("partial coverage: every bucket and every breakdown reason exercised at once, invariant holds", () => {
  const a = attribute(loadSynthetic("partial-coverage-mixed.json"));
  assert.equal(a.zone2_seconds, 32);
  assert.equal(a.non_moving_seconds, 1);
  assert.equal(a.unrepresented_breakdown.missing_hr_seconds, 1);
  assert.equal(a.unrepresented_breakdown.large_gap_seconds, 1);
  assert.equal(a.total_represented_seconds, 35);
  assertInvariant(a);
});

test("real treadmill stream (multi-metric-eligibility proof) -- hand-derived: other_zone=2s, zone2=0", () => {
  const a = attribute(loadReal("treadmill-hr-streams.json"));
  assert.equal(a.other_zone_seconds, 2); // hr 180, 180 -- both Zone 4, not Zone 2
  assert.equal(a.zone2_seconds, 0);
  assert.equal(a.total_represented_seconds, 2);
  assertInvariant(a);
});

test("real outdoor-run excerpt -- hand-derived: non_moving=5s, other_zone=4s, zone2=0 (HR never reaches 132 in this warm-up excerpt)", () => {
  const a = attribute(loadReal("outdoor-run-hr-streams-excerpt.json"));
  assert.equal(a.non_moving_seconds, 5);
  assert.equal(a.other_zone_seconds, 4);
  assert.equal(a.zone2_seconds, 0);
  assert.equal(a.total_represented_seconds, 9);
  assertInvariant(a);
});
