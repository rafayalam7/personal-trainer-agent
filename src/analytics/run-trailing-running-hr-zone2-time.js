#!/usr/bin/env node
// Practical entry point for trailing_running_hr_zone2_time -- same discipline as
// run-trailing-running-distance.js: reads raw capture files, prints one JSON
// result, never asks Claude to transcribe or recompute any number inside it.
//
// Usage:
//   node src/analytics/run-trailing-running-hr-zone2-time.js \
//     <windowEndIso> <activityListCaptureFile> <zoneConfigCaptureFile> <streamCaptureFile...>
//
// windowEndIso: explicit, naive strings resolved via config.timezone (never
//   the invoking machine's system timezone) -- see run-trailing-running-distance.js
//   for why that distinction matters.
const {
  readCaptureFile,
  adaptCaptures,
  adaptHrStreamCaptures,
  adaptZoneConfigCapture,
} = require("./adapter");
const { computeTrailingRunningHrZone2Time } = require("./metrics/trailing-running-hr-zone2-time");
const { resolveLocal } = require("./normalize");
const config = require("./config");

function parseWindowEnd(arg) {
  if (!arg) return Date.now();
  const hasExplicitOffset = /Z$|[+-]\d{2}:\d{2}$/.test(arg);
  if (hasExplicitOffset) return new Date(arg).getTime();
  return resolveLocal(arg, config.timezone).epochMs;
}

function main(argv) {
  const [windowEndArg, activityListFile, zoneConfigFile, ...streamFiles] = argv;
  if (!activityListFile || !zoneConfigFile) {
    process.stderr.write(
      "Usage: run-trailing-running-hr-zone2-time.js <windowEndIso> <activityListCaptureFile> <zoneConfigCaptureFile> <streamCaptureFile...>\n"
    );
    process.exit(1);
  }

  const windowEndEpochMs = parseWindowEnd(windowEndArg);
  if (windowEndEpochMs === null || Number.isNaN(windowEndEpochMs)) {
    process.stderr.write(`Could not parse windowEndIso: "${windowEndArg}"\n`);
    process.exit(1);
  }

  const activityListCapture = readCaptureFile(activityListFile);
  const { retrievalStatus: activityRetrievalStatus, activities } = adaptCaptures([activityListCapture]);

  const zoneConfigCapture = readCaptureFile(zoneConfigFile);
  const { retrievalStatus: zoneRetrievalStatus, zoneConfig } = adaptZoneConfigCapture(zoneConfigCapture, config);

  const streamCaptures = streamFiles.map(readCaptureFile);
  const hrStreamsByActivityId = adaptHrStreamCaptures(streamCaptures);

  // Activity-list retrieval failing takes precedence -- we can't even know
  // what to consider. Zone retrieval failing is checked next, inside the
  // metric itself (it needs to distinguish "failed" from "retrieved but
  // invalid", so both statuses are passed through rather than pre-collapsed).
  const retrievalStatus = activityRetrievalStatus === "failed" || zoneRetrievalStatus === "failed" ? "failed" : "ok";

  const result = computeTrailingRunningHrZone2Time({
    activities,
    hrStreamsByActivityId,
    zoneConfig,
    windowEndEpochMs,
    retrievalStatus,
    config,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main(process.argv.slice(2));
