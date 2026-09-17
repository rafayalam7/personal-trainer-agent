// Adapter layer: pure transform from one raw Strava activity object (as returned by
// list_activities, with include_tags:true) into our normalized representation.
// Deliberately minimal — only what trailing-running-distance needs. No validity
// judgment happens here; that's eligibility.js's job (see CONTRACT-trailing-running-distance.md).
const config = require("./config");

function classifySport(sourceSportType) {
  return config.sportClassification[sourceSportType] ?? "other";
}

// Strava's start_local has no offset info at all (re-confirmed directly against
// real captured payloads, not just the athlete profile). Timezone is explicit
// local configuration (an IANA zone, config.timezone) — never guessed from any
// MCP field, never looked up from a geo service. Resolution to an absolute
// instant uses Node's built-in Intl (full ICU) to find the UTC offset that
// actually applies to a given instant in that zone, which is DST-aware — unlike
// a single fixed offset, which is wrong for roughly half the year.
function offsetMinutesForZoneAt(utcMs, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset", hour: "2-digit" });
  const part = dtf.formatToParts(new Date(utcMs)).find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(part);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3], 10));
}

// Converts a naive local timestamp ("2026-09-09T18:28:46") into an absolute
// instant plus the offset that applied, given an IANA zone. Algorithm: guess
// the offset using the naive timestamp interpreted as UTC, then refine once
// using the offset that actually applies at the resulting instant (matters
// right at a DST transition). Known, accepted V1 limitation: the local time
// that never occurs (the "spring forward" gap) or occurs twice (the "fall
// back" overlap) is not specially disambiguated — extremely unlikely for a
// logged workout, which would fall in the 2-3am local window on one specific
// day per year.
function resolveLocal(localNaiveString, timeZone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(localNaiveString ?? "");
  if (!m) return { epochMs: null, offsetMinutes: null };
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const naiveAsUtcMs = Date.UTC(y, mo - 1, d, h, mi, s);

  const offsetGuessMin = offsetMinutesForZoneAt(naiveAsUtcMs, timeZone);
  let epochMs = naiveAsUtcMs - offsetGuessMin * 60000;
  let offsetMinutes = offsetGuessMin;

  const offsetRefinedMin = offsetMinutesForZoneAt(epochMs, timeZone);
  if (offsetRefinedMin !== offsetGuessMin) {
    epochMs = naiveAsUtcMs - offsetRefinedMin * 60000;
    offsetMinutes = offsetRefinedMin;
  }

  return { epochMs, offsetMinutes };
}

/**
 * @param {object} rawActivity - one element of a list_activities response's `activities` array
 * @param {object} meta - { captureRef: string, capturedAt: string }
 */
function normalize(rawActivity, meta) {
  const summary = rawActivity.summary ?? {};
  const { epochMs, offsetMinutes } = resolveLocal(rawActivity.start_local, config.timezone);

  return {
    schema_version: config.schemaVersion,
    source: "strava",
    source_activity_id: String(rawActivity.id),
    source_sport_type: rawActivity.sport_type ?? null,
    internal_activity_type: classifySport(rawActivity.sport_type),
    start_at_local: rawActivity.start_local ?? null,
    start_at_epoch_ms: epochMs,
    interpreted_timezone: config.timezone,
    // The specific offset that applied for THIS activity's instant (provenance
    // only) — varies by season, unlike the fixed-offset field it replaces.
    resolved_utc_offset_minutes: offsetMinutes,
    // Preserve absence as null — is_trainer is only present when include_tags:true
    // was passed at retrieval time. Never default this to false.
    is_trainer: typeof rawActivity.is_trainer === "boolean" ? rawActivity.is_trainer : null,
    moving_time_s: typeof summary.moving_time === "number" ? summary.moving_time : null,
    elapsed_time_s: typeof summary.elapsed_time === "number" ? summary.elapsed_time : null,
    distance: {
      value_m: typeof summary.distance === "number" ? summary.distance : null,
      source: "strava_summary",
    },
    capture_ref: meta?.captureRef ?? null,
    captured_at: meta?.capturedAt ?? null,
  };
}

module.exports = { normalize, classifySport, resolveLocal };
