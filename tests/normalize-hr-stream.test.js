const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalizeHeartRateStream } = require("../src/analytics/normalize-hr-stream");

function loadSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "synthetic", name), "utf8"));
}
function loadReal(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "hr-zone", "real", name), "utf8"));
}

test("null HR is preserved, never dropped -- alignment stays 1:1 with time/moving", () => {
  const raw = loadSynthetic("null-hr-alignment.json");
  const n = normalizeHeartRateStream(raw, { activityId: "syn-hr-011", captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(n.samples.length, 3); // NOT collapsed to 2
  assert.equal(n.samples[0].hr, 145);
  assert.equal(n.samples[1].hr, null); // preserved as null, not filtered out
  assert.equal(n.samples[1].moving, false);
  assert.equal(n.samples[2].hr, 148);
  assert.equal(n.heart_rate_stream_present, true); // the key existed; one value happens to be null
});

test("heart_rate key entirely absent is a distinct, structural finding from a present-but-null value", () => {
  const raw = loadSynthetic("no-hr-stream.json");
  const n = normalizeHeartRateStream(raw, { activityId: "syn-hr-004", captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(n.heart_rate_stream_present, false);
  // Every sample's hr is null here too, but for a DIFFERENT reason than the
  // alignment test above -- eligibility-hr-zone.js must check
  // heart_rate_stream_present, never infer absence from all-null values.
  assert.ok(n.samples.every((s) => s.hr === null));
});

test("real treadmill stream (3 samples) normalizes without truncation or filtering", () => {
  const raw = loadReal("treadmill-hr-streams.json");
  const n = normalizeHeartRateStream(raw, { activityId: "90000000001", captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(n.samples.length, 3);
  assert.deepEqual(n.samples.map((s) => s.hr), [180, 180, 178]);
  assert.deepEqual(n.samples.map((s) => s.moving), [true, true, true]);
});

test("real outdoor-run excerpt preserves the real moving:false warm-up period", () => {
  const raw = loadReal("outdoor-run-hr-streams-excerpt.json");
  const n = normalizeHeartRateStream(raw, { activityId: "90000000005", captureRef: "test", capturedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(n.samples.length, 10);
  assert.equal(n.samples[0].moving, false);
  assert.equal(n.samples[4].moving, true);
});
