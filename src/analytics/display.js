// Display conversion, deliberately separate from the metric calculation itself
// (trailing-running-distance.js never imports this). Internal results stay in
// meters; this only runs when formatting a result for a human/coaching context.
function metersToMiles(meters, config) {
  return meters / config.metersPerMile;
}

// trailing_running_hr_zone2_time never imports this either -- internal result
// stays in seconds; only Weekly Review's interpretation step converts.
function secondsToMinutes(seconds) {
  return seconds / 60;
}

module.exports = { metersToMiles, secondsToMinutes };
