const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { normalize, resolveLocal } = require("../src/analytics/normalize");
const config = require("../src/analytics/config");

function loadReal(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "real", name), "utf8"));
}

// --- Step 4: real source examples, walked through the adapter ---

test("real valid outdoor run normalizes with is_trainer:false and a usable distance", () => {
  const raw = loadReal("outdoor-run-valid.json");
  const n = normalize(raw, { captureRef: "test", capturedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(n.source_activity_id, "90000000005");
  assert.equal(n.internal_activity_type, "run");
  assert.equal(n.is_trainer, false);
  assert.equal(n.distance.value_m, 4848.7);
  assert.equal(n.moving_time_s, 1905);
  assert.equal(typeof n.start_at_epoch_ms, "number");
});

test("real treadmill run normalizes with is_trainer:true and distance 0 (structural, not yet a validity judgment)", () => {
  const raw = loadReal("treadmill-run-invalid.json");
  const n = normalize(raw, { captureRef: "test", capturedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(n.is_trainer, true);
  assert.equal(n.distance.value_m, 0);
  assert.equal(n.moving_time_s, 2);
  // normalize.js never judges validity -- that's eligibility.js's job. This
  // activity's raw ingredients are faithfully carried through either way.
});

test("real outdoor-but-corrupted run normalizes with is_trainer:false yet an implausible moving_time", () => {
  const raw = loadReal("outdoor-run-corrupted-summary.json");
  const n = normalize(raw, { captureRef: "test", capturedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(n.is_trainer, false);
  assert.equal(n.distance.value_m, 41.9222);
  assert.equal(n.moving_time_s, 8);
  // is_trainer:false alone would look "fine" here -- proves why eligibility.js
  // needs the moving_time floor, not just the trainer flag.
});

test("real treadmill run with a genuine Technogym sync normalizes with is_trainer:true and a usable distance", () => {
  const raw = loadReal("treadmill-run-valid.json");
  const n = normalize(raw, { captureRef: "test", capturedAt: "2026-09-17T00:00:00.000Z" });
  assert.equal(n.is_trainer, true);
  assert.equal(n.distance.value_m, 4839.7);
  assert.equal(n.moving_time_s, 1975);
  // is_trainer:true alone would look "unusable" here under the old rule --
  // proves why eligibility.js must judge distance/moving_time evidence
  // directly rather than gating on the trainer flag.
});

test("real activity outside a later window still normalizes the same way -- window membership is the metric's job, not normalize's", () => {
  const raw = loadReal("outdoor-run-outside-window-example.json");
  const n = normalize(raw, { captureRef: "test", capturedAt: "2026-09-11T00:00:00.000Z" });
  assert.equal(n.distance.value_m, 4506.17);
  assert.equal(n.start_at_local, "2026-09-04T19:10:00");
  // normalize.js doesn't know about any window at all -- confirmed by the
  // absence of a `windowEnd` parameter in its signature.
});

// --- normalize.js unit behavior ---

test("unmapped sport_type classifies as 'other', not guessed", () => {
  const n = normalize(
    { id: 1, sport_type: "TrailRun", start_local: "2026-09-08T08:00:00", summary: {} },
    {}
  );
  assert.equal(n.internal_activity_type, "other");
});

test("missing is_trainer (tags not requested) stays null, never defaults to false", () => {
  const n = normalize(
    { id: 2, sport_type: "Run", start_local: "2026-09-08T08:00:00", summary: { distance: 100 } },
    {}
  );
  assert.equal(n.is_trainer, null);
});

test("missing distance field stays null, never coerced to 0", () => {
  const n = normalize(
    { id: 3, sport_type: "Run", start_local: "2026-09-08T08:00:00", is_trainer: false, summary: {} },
    {}
  );
  assert.equal(n.distance.value_m, null);
});

test("source_activity_id is always a string, even if the raw id were numeric", () => {
  const n = normalize({ id: 12345, sport_type: "Run", start_local: "2026-09-08T08:00:00", summary: {} }, {});
  assert.equal(n.source_activity_id, "12345");
  assert.equal(typeof n.source_activity_id, "string");
});

// --- DST-transition determinism (Step 1 refinement: explicit IANA timezone
// config + Intl-based resolution, replacing a fixed UTC offset) ---

test("local-to-epoch resolution is deterministic and correctly DST-aware across the real 2026 US spring-forward transition", () => {
  // 2026-03-08 02:00 local is when America/Chicago jumps from CST (-06:00) to
  // CDT (-05:00). A naive fixed-offset implementation would compute a flat
  // 48-hour gap between these two 08:00-local instants two days apart; the
  // real elapsed wall-clock-independent time is 47 hours, because one hour
  // was skipped. This is hand-derived here, independent of the function under
  // test: 2026-03-07T08:00 local = 2026-03-07T14:00 UTC (-06:00, before the
  // transition); 2026-03-09T08:00 local = 2026-03-09T13:00 UTC (-05:00,
  // after) -- 48h minus the 1h skipped = 47h = 169_200_000 ms.
  const before = resolveLocal("2026-03-07T08:00:00", config.timezone);
  const after = resolveLocal("2026-03-09T08:00:00", config.timezone);

  assert.equal(before.offsetMinutes, -360); // -06:00 CST
  assert.equal(after.offsetMinutes, -300); // -05:00 CDT
  assert.equal(after.epochMs - before.epochMs, 47 * 3600 * 1000);
  assert.notEqual(after.epochMs - before.epochMs, 48 * 3600 * 1000); // what a fixed offset would have wrongly given

  // Determinism: calling it again for the same inputs gives the same instant.
  assert.equal(resolveLocal("2026-03-07T08:00:00", config.timezone).epochMs, before.epochMs);
});

test("local-to-epoch resolution is correctly DST-aware across the real 2026 US fall-back transition", () => {
  // 2026-11-01 02:00 local is when America/Chicago falls back from CDT
  // (-05:00) to CST (-06:00) -- the reverse case, one extra hour gained.
  // 2026-10-31T08:00 local = 2026-10-31T13:00 UTC (-05:00, before);
  // 2026-11-02T08:00 local = 2026-11-02T14:00 UTC (-06:00, after) --
  // 48h plus the 1h gained = 49h = 176_400_000 ms.
  const before = resolveLocal("2026-10-31T08:00:00", config.timezone);
  const after = resolveLocal("2026-11-02T08:00:00", config.timezone);

  assert.equal(before.offsetMinutes, -300); // -05:00 CDT
  assert.equal(after.offsetMinutes, -360); // -06:00 CST
  assert.equal(after.epochMs - before.epochMs, 49 * 3600 * 1000);
});
