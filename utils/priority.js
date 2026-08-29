// Priority-scoring engine — ported 1:1 from the client-side
// `calculatePriority()` / `getSlaText()` functions in the original mock,
// now the single source of truth (the browser no longer computes this).

const { CRITICAL_ZONES } = require('./zones');

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Returns the nearest critical zone whose radius contains `loc`, or null.
function detectNearestZone(loc) {
  let match = null;
  let minD = Infinity;
  for (const z of CRITICAL_ZONES) {
    const d = haversineMeters(z, loc);
    if (d <= z.radius && d < minD) {
      match = { ...z, distanceM: Math.round(d) };
      minD = d;
    }
  }
  return match;
}

// ticket: { zone, votes, urgent, createdAt (ms epoch) }
function calculatePriority(ticket) {
  let score = 15;
  if (ticket.zone) score += ticket.zone.bonus;
  score += (ticket.votes || 1) * 5;
  if (ticket.urgent) score += 40;
  const daysOld = Math.floor((Date.now() - ticket.createdAt) / (1000 * 60 * 60 * 24));
  score += Math.min(daysOld * 3, 20);
  return Math.min(score, 100);
}

function getSlaText(score) {
  if (score >= 80) return '🚨 Critical (12-24h Target)';
  if (score >= 50) return '⚡ High (48h Target)';
  if (score >= 30) return '🟡 Medium (72h Target)';
  return '🟢 Standard (5 Days Target)';
}

module.exports = { haversineMeters, detectNearestZone, calculatePriority, getSlaText };
