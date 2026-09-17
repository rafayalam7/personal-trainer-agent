// Shared window-membership and dedup logic. Extracted once a second metric
// needed the exact same rules -- factoring this out is what actually enforces
// "do not introduce a second meaning of 168 hours," at the code level, not just
// in documentation. Both metrics import this; neither reimplements it.

// Half-open (window_start, window_end] -- window_start EXCLUDED, window_end
// INCLUDED. See CONTRACT-trailing-running-distance.md "Window boundary
// convention": lets adjacent trailing windows tile without a boundary activity
// ever being double-counted.
function filterToWindow(activities, { windowStartEpochMs, windowEndEpochMs, activityType }) {
  return activities.filter(
    (a) =>
      (!activityType || a.internal_activity_type === activityType) &&
      a.start_at_epoch_ms !== null &&
      a.start_at_epoch_ms > windowStartEpochMs &&
      a.start_at_epoch_ms <= windowEndEpochMs
  );
}

// Deduplicate by source_activity_id. Precedence: most recently *captured*
// version wins (by captured_at), never by array position -- must hold
// regardless of input order.
function dedupeByActivityId(activities) {
  const byId = new Map();
  for (const activity of activities) {
    const existing = byId.get(activity.source_activity_id);
    if (!existing || (activity.captured_at ?? "") > (existing.captured_at ?? "")) {
      byId.set(activity.source_activity_id, activity);
    }
  }
  return [...byId.values()];
}

module.exports = { filterToWindow, dedupeByActivityId };
