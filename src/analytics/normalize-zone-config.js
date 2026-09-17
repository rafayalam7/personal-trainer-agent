// Pure transform: raw get_athlete_zones response -> the one zone this metric
// needs. Never derives boundaries from age/max-HR/a generic formula -- only
// ever reads what Strava's own configured zones returned.
function normalizeZoneConfig(rawZones, meta, config) {
  const zones = Array.isArray(rawZones?.heart_rate_zones) ? rawZones.heart_rate_zones : null;
  const zone2Index = config.heartRateZoneTime.zone2Index;
  const candidate = zones ? zones[zone2Index] : undefined;

  const valid =
    !!candidate &&
    typeof candidate.min === "number" &&
    Number.isFinite(candidate.min) &&
    (candidate.max === undefined || (typeof candidate.max === "number" && candidate.max > candidate.min));

  return {
    zone2: valid ? { min: candidate.min, max: candidate.max ?? null } : null,
    valid,
    source: rawZones?.heart_rate_zone_source ?? null,
    all_zones_raw: zones,
    capture_ref: meta?.captureRef ?? null,
    captured_at: meta?.capturedAt ?? null,
  };
}

module.exports = { normalizeZoneConfig };
