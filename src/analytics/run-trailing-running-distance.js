#!/usr/bin/env node
// Practical entry point: what Claude actually runs during a Weekly Review to get
// a structured trailing_running_distance result. Reads raw capture files (never
// hand-transcribed numbers) and prints one JSON result to stdout -- Claude reads
// that JSON, it never recomputes or edits the numbers inside it.
//
// Usage:
//   node src/analytics/run-trailing-running-distance.js <windowEndIso> <captureFile...>
//
// windowEndIso: e.g. "2026-09-11T22:00:00-05:00" or a naive "2026-09-11T22:00:00"
//   -- always explicit, never "now" inferred silently. If omitted, defaults to
//   the current instant at invocation time (logged in provenance either way).
//
// A naive string (no trailing Z or +/-HH:MM) is resolved through config.timezone
// (America/Chicago), the SAME explicit configuration used for activity
// timestamps -- never through the invoking machine's own system timezone. This
// was a real gap found during verification: Node's native Date parser falls
// back to system-local time for an offset-less string, which is an ambient
// property of whatever machine happens to run this script, not an explicit
// decision -- exactly what config.timezone exists to avoid.
const { readCaptureFile, adaptCaptures } = require("./adapter");
const { computeTrailingRunningDistance } = require("./metrics/trailing-running-distance");
const { resolveLocal } = require("./normalize");
const config = require("./config");

function parseWindowEnd(arg) {
  if (!arg) return Date.now();
  const hasExplicitOffset = /Z$|[+-]\d{2}:\d{2}$/.test(arg);
  if (hasExplicitOffset) {
    return new Date(arg).getTime();
  }
  return resolveLocal(arg, config.timezone).epochMs;
}

function main(argv) {
  const [windowEndArg, ...captureFiles] = argv;
  if (captureFiles.length === 0) {
    process.stderr.write(
      "Usage: run-trailing-running-distance.js <windowEndIso> <captureFile...>\n"
    );
    process.exit(1);
  }

  const windowEndEpochMs = parseWindowEnd(windowEndArg);
  if (windowEndEpochMs === null || Number.isNaN(windowEndEpochMs)) {
    process.stderr.write(`Could not parse windowEndIso: "${windowEndArg}"\n`);
    process.exit(1);
  }

  const captures = captureFiles.map(readCaptureFile);
  const { retrievalStatus, activities } = adaptCaptures(captures);

  const result = computeTrailingRunningDistance({
    activities,
    windowEndEpochMs,
    retrievalStatus,
    config,
  });

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

main(process.argv.slice(2));
