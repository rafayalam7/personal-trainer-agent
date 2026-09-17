const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { adaptCaptures } = require("../src/analytics/adapter");

function loadSynthetic(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "synthetic", name), "utf8"));
}

// Real evidence, not a hypothetical: this session's own first:30 activity-list
// capture had has_next_page:true and was, until this fix, silently treated as
// a complete retrieval by every prior "real data" verification.
test("a single page claiming more activities exist (has_next_page:true), with no terminal page provided, is incomplete retrieval", () => {
  const capture = loadSynthetic("list-activities-incomplete-pagination.json");
  const { retrievalStatus, activities } = adaptCaptures([capture]);
  assert.equal(retrievalStatus, "failed");
  assert.equal(activities.length, 0);
});

test("a genuine two-page sequence (page 1 has_next_page:true, page 2 has_next_page:false) is complete, and combines both pages' activities", () => {
  const page1 = loadSynthetic("list-activities-page1-of-2.json");
  const page2 = loadSynthetic("list-activities-page2-of-2.json");
  const { retrievalStatus, activities } = adaptCaptures([page1, page2]);
  assert.equal(retrievalStatus, "ok");
  assert.equal(activities.length, 2);
});

test("completeness detection is order-independent -- the terminal page can be passed first", () => {
  const page1 = loadSynthetic("list-activities-page1-of-2.json");
  const page2 = loadSynthetic("list-activities-page2-of-2.json");
  const { retrievalStatus, activities } = adaptCaptures([page2, page1]);
  assert.equal(retrievalStatus, "ok");
  assert.equal(activities.length, 2);
});

test("a single page with has_next_page:false is trivially complete (the common single-page case)", () => {
  const capture = {
    status: "ok",
    tool_name: "mcp__strava-mcp__list_activities",
    captured_at: "2026-09-12T00:00:00.000Z",
    parsed: { activities: [], has_next_page: false },
  };
  const { retrievalStatus } = adaptCaptures([capture]);
  assert.equal(retrievalStatus, "ok");
});
