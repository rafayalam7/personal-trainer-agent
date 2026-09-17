const test = require("node:test");
const assert = require("node:assert/strict");
const { eligibilityForHrZoneTime } = require("../src/analytics/eligibility-hr-zone");

function activity(overrides) {
  return { internal_activity_type: "run", ...overrides };
}

test("non-run sport is unsupported", () => {
  const v = eligibilityForHrZoneTime(activity({ internal_activity_type: "lift" }), {
    heart_rate_stream_present: true,
    samples: [{ t: 0, hr: 140, moving: true }, { t: 1, hr: 140, moving: true }],
  });
  assert.equal(v.eligible, false);
  assert.equal(v.state, "unsupported");
});

test("per-activity stream retrieval failure is distinct from never having HR data", () => {
  const v = eligibilityForHrZoneTime(activity({}), { retrieval_failed: true });
  assert.equal(v.eligible, false);
  assert.equal(v.state, "retrieval_failed");
});

test("heart_rate_stream_present:false is 'missing'", () => {
  const v = eligibilityForHrZoneTime(activity({}), { heart_rate_stream_present: false, samples: [{ t: 0, hr: null, moving: null }] });
  assert.equal(v.eligible, false);
  assert.equal(v.state, "missing");
});

test("no stream captured at all (undefined) is also 'missing'", () => {
  const v = eligibilityForHrZoneTime(activity({}), undefined);
  assert.equal(v.eligible, false);
  assert.equal(v.state, "missing");
});

test("fewer than 2 samples is 'invalid' -- cannot construct any interval", () => {
  const v = eligibilityForHrZoneTime(activity({}), {
    heart_rate_stream_present: true,
    samples: [{ t: 0, hr: 140, moving: true }],
  });
  assert.equal(v.eligible, false);
  assert.equal(v.state, "invalid");
});

test("a treadmill run (irrelevant here) with a usable 3-sample HR stream is eligible -- the multi-metric-eligibility proof", () => {
  const v = eligibilityForHrZoneTime(activity({}), {
    heart_rate_stream_present: true,
    samples: [
      { t: 0, hr: 180, moving: true },
      { t: 1, hr: 180, moving: true },
      { t: 2, hr: 178, moving: true },
    ],
  });
  assert.equal(v.eligible, true);
  assert.equal(v.state, "valid");
});
