// ---------------------------------------------------------------------
// Civic Lens "database" — a tiny JSON-file store.
//
// Why not a real database? This is a hackathon backend: zero native
// dependencies (no SQLite/Postgres driver to compile or install), the
// whole dataset fits comfortably in memory, and the file at
// data/db.json is human-readable so you can open it and see exactly
// what state the app is in. Every table below is just an array kept in
// memory and flushed to disk after each mutation.
//
// Swapping this for Postgres/DynamoDB/Aurora later only means rewriting
// the functions in this file — every route file calls these functions,
// never the arrays directly, so the rest of the app doesn't change.
// ---------------------------------------------------------------------

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');

const { CRITICAL_ZONES } = require('./utils/zones');

function ticketUid() {
  return 'CL-2026-' + Math.floor(10000 + Math.random() * 89999);
}

function seedState() {
  const now = Date.now();
  return {
    users: [],
    tickets: [
      {
        id: ticketUid(),
        category: 'Pothole',
        loc: { label: 'MG Road, 40m from AIIMS Gate', lat: 28.5675, lng: 77.2104 },
        status: 'Received',
        urgent: true,
        votes: 24,
        createdAt: now - 1000 * 60 * 60 * 36,
        zone: CRITICAL_ZONES[0],
        reporterId: null,
        reporterLabel: 'Priya M. (Ward 14)',
        photoPath: null,
        reports: [
          { photoPath: null, createdAt: now - 1000 * 60 * 60 * 36, userLabel: 'Priya M.' },
          { photoPath: null, createdAt: now - 1000 * 60 * 60 * 22, userLabel: 'Rahul V.' },
          { photoPath: null, createdAt: now - 1000 * 60 * 60 * 8, userLabel: 'Aarav K.' },
        ],
        rating: null,
      },
      {
        id: ticketUid(),
        category: 'Sewer',
        loc: { label: 'Park St, adjacent to DPS School', lat: 28.6248, lng: 77.2183 },
        status: 'Received',
        urgent: true,
        votes: 16,
        createdAt: now - 1000 * 60 * 60 * 18,
        zone: CRITICAL_ZONES[1],
        reporterId: null,
        reporterLabel: 'Sunita D. (Ward 21)',
        photoPath: null,
        reports: [{ photoPath: null, createdAt: now - 1000 * 60 * 60 * 18, userLabel: 'Sunita D.' }],
        rating: null,
      },
      {
        id: ticketUid(),
        category: 'Traffic',
        loc: { label: 'Outer Ring Road Blind Curve', lat: 28.6382, lng: 77.2253 },
        status: 'Received',
        urgent: false,
        votes: 9,
        createdAt: now - 1000 * 60 * 60 * 12,
        zone: CRITICAL_ZONES[2],
        reporterId: null,
        reporterLabel: 'Vikas R. (Ward 08)',
        photoPath: null,
        reports: [{ photoPath: null, createdAt: now - 1000 * 60 * 60 * 12, userLabel: 'Vikas R.' }],
        rating: null,
      },
      {
        id: ticketUid(),
        category: 'Streetlight',
        loc: { label: 'Sector 9 Residential Lane 4', lat: 28.6180, lng: 77.2120 },
        status: 'Working On It',
        urgent: false,
        votes: 5,
        createdAt: now - 1000 * 60 * 60 * 48,
        zone: null,
        reporterId: null,
        reporterLabel: 'Deepak S. (Ward 14)',
        photoPath: null,
        reports: [{ photoPath: null, createdAt: now - 1000 * 60 * 60 * 48, userLabel: 'Deepak S.' }],
        rating: null,
      },
    ],
    ticketVotes: [], // { ticketId, userId }
    notifications: [], // { id, userId, title, body, icon, isResolution, ticketId, read, createdAt }
    otps: {}, // phone -> { code, expiresAt }
  };
}

let state;

function load() {
  if (state) return state;
  if (fs.existsSync(DB_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      return state;
    } catch (e) {
      console.error('[db] db.json was unreadable, reseeding:', e.message);
    }
  }
  state = seedState();
  persist();
  return state;
}

function persist() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(state, null, 2));
}

function resetToSeed() {
  state = seedState();
  persist();
  console.log('[db] reset to seed data at', DB_PATH);
}

module.exports = { load, persist, resetToSeed, ticketUid };
