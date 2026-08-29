const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { findUserById } = require('./auth.routes');
const { DUP_THRESHOLD_METERS } = require('../utils/zones');
const { haversineMeters, detectNearestZone, calculatePriority, getSlaText } = require('../utils/priority');

const router = express.Router();

// ---------------------------------------------------------------------
// Photo upload handling
// ---------------------------------------------------------------------
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image uploads are accepted.'));
    cb(null, true);
  },
});

function photoUrl(filename) {
  return filename ? `/uploads/${filename}` : null;
}

function addNotification(state, { userId, title, body, icon, isResolution, ticketId }) {
  state.notifications.unshift({
    id: uuidv4(),
    userId,
    title,
    body,
    icon,
    isResolution: !!isResolution,
    ticketId,
    read: false,
    createdAt: Date.now(),
  });
}

// Shapes a ticket for the API response: adds the live-computed priority
// score/SLA, resolves photo paths to URLs, and (if the caller is signed
// in) whether *they* have upvoted it.
function serializeTicket(t, viewerUserId) {
  const score = calculatePriority(t);
  const reporter = t.reporterId ? findUserById(t.reporterId) : null;
  return {
    id: t.id,
    category: t.category,
    loc: t.loc,
    status: t.status,
    urgent: t.urgent,
    votes: t.votes,
    createdAt: t.createdAt,
    zone: t.zone,
    reporterLabel: t.reporterLabel || (reporter ? `${reporter.name} (${reporter.ward})` : 'Verified Citizen'),
    photo: photoUrl(t.photoPath),
    reports: (t.reports || []).map((r) => ({ photo: photoUrl(r.photoPath), createdAt: r.createdAt, userLabel: r.userLabel })),
    rating: t.rating,
    score,
    sla: getSlaText(score),
    userUpvoted: viewerUserId ? db.load().ticketVotes.some((v) => v.ticketId === t.id && v.userId === viewerUserId) : false,
  };
}

function findTicketOr404(req, res) {
  const state = db.load();
  const t = state.tickets.find((x) => x.id === req.params.id);
  if (!t) {
    res.status(404).json({ error: `No ticket with id ${req.params.id}.` });
    return null;
  }
  return t;
}

// ---------------------------------------------------------------------
// List / filter / sort — the public Track & Upvote queue
// ---------------------------------------------------------------------

// GET /api/tickets?search=&sort=priority|votes|newest&cat=&zone=
router.get('/', (req, res) => {
  const state = db.load();
  const { search = '', sort = 'priority', cat = '', zone = '' } = req.query;
  const q = String(search).toLowerCase().trim();

  let list = state.tickets.filter((t) => {
    if (cat && t.category !== cat) return false;
    if (zone && (!t.zone || t.zone.type !== zone)) return false;
    if (q && !(t.id.toLowerCase().includes(q) || t.loc.label.toLowerCase().includes(q) || (t.zone && t.zone.name.toLowerCase().includes(q)))) return false;
    return true;
  });

  const serialized = list.map((t) => serializeTicket(t, req.userId));

  if (sort === 'votes') serialized.sort((a, b) => b.votes - a.votes);
  else if (sort === 'newest') serialized.sort((a, b) => b.createdAt - a.createdAt);
  else serialized.sort((a, b) => b.score - a.score); // priority (default)

  res.json({
    tickets: serialized,
    openCount: state.tickets.filter((t) => t.status !== 'Completed').length,
  });
});

// GET /api/tickets/:id
router.get('/:id', (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  res.json({ ticket: serializeTicket(t, req.userId) });
});

// ---------------------------------------------------------------------
// AI verification / spatial-analysis preview (Step 2 of the report flow)
// ---------------------------------------------------------------------

// POST /api/tickets/analyze { category, lat, lng, urgent }
// Read-only: detects the nearest critical zone and any open ticket of the
// same category within 30m, and previews the priority score that a new
// report would get. The frontend plays its verification-steps animation
// while this call is in flight, then either shows the duplicate modal or
// moves to the confirmation screen using this response.
router.post('/analyze', requireAuth, (req, res) => {
  const { category, lat, lng, urgent } = req.body;
  if (!category || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'category, lat and lng are required.' });
  }
  const state = db.load();
  const loc = { lat, lng };
  const zone = detectNearestZone(loc);

  const existing = state.tickets.find(
    (t) => t.status !== 'Completed' && t.category === category && haversineMeters(t.loc, loc) <= DUP_THRESHOLD_METERS
  );

  const tempTicket = { zone, votes: 1, urgent: !!urgent, createdAt: Date.now() };
  const estimatedScore = calculatePriority(tempTicket);

  res.json({
    zone,
    duplicate: existing ? serializeTicket(existing, req.userId) : null,
    distanceMeters: existing ? Math.round(haversineMeters(existing.loc, loc)) : null,
    estimatedScore,
    sla: getSlaText(estimatedScore),
  });
});

// ---------------------------------------------------------------------
// Create a new report
// ---------------------------------------------------------------------

// POST /api/tickets  multipart/form-data: photo (file), category, lat, lng,
// label, urgent ("true"/"false"). `force` bypasses the duplicate check
// (the client already ran /analyze and the citizen chose "this is a
// different issue").
router.post('/', requireAuth, upload.single('photo'), (req, res) => {
  const { category, lat, lng, label, urgent, force } = req.body;
  const latN = parseFloat(lat);
  const lngN = parseFloat(lng);
  if (!category || Number.isNaN(latN) || Number.isNaN(lngN)) {
    return res.status(400).json({ error: 'category, lat and lng are required.' });
  }

  const state = db.load();
  const loc = { lat: latN, lng: lngN, label: label || 'Reported Location' };

  if (force !== 'true') {
    const existing = state.tickets.find(
      (t) => t.status !== 'Completed' && t.category === category && haversineMeters(t.loc, loc) <= DUP_THRESHOLD_METERS
    );
    if (existing) {
      return res.status(409).json({ error: 'A matching report already exists nearby.', duplicate: serializeTicket(existing, req.userId) });
    }
  }

  const user = findUserById(req.userId);
  const zone = detectNearestZone(loc);
  const ticket = {
    id: db.ticketUid(),
    category,
    loc,
    status: 'Received',
    urgent: urgent === 'true' || urgent === true,
    votes: 1,
    createdAt: Date.now(),
    zone,
    reporterId: user.id,
    reporterLabel: `${user.name} (${user.ward})`,
    photoPath: req.file ? req.file.filename : null,
    reports: [{ photoPath: req.file ? req.file.filename : null, createdAt: Date.now(), userLabel: `${user.name} (Primary Reporter)` }],
    rating: null,
  };
  state.tickets.unshift(ticket);

  addNotification(state, {
    userId: user.id,
    title: 'Problem Taken into Consideration 📝',
    body: `Thank you ${user.name} for sharing the problem with us! Ticket ${ticket.id} has been registered and you will be informed when it is solved.`,
    icon: '📸',
    isResolution: false,
    ticketId: ticket.id,
  });
  db.persist();

  res.status(201).json({ ticket: serializeTicket(ticket, req.userId) });
});

// ---------------------------------------------------------------------
// Duplicate-resolution actions (from the 30m proximity modal)
// ---------------------------------------------------------------------

// POST /api/tickets/:id/support  multipart/form-data: photo (optional)
// "Same problem — upvote and add my photo"
router.post('/:id/support', requireAuth, upload.single('photo'), (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  const state = db.load();
  const user = findUserById(req.userId);

  t.votes += 1;
  t.reports = t.reports || [];
  t.reports.push({ photoPath: req.file ? req.file.filename : null, createdAt: Date.now(), userLabel: `${user.name} (${user.ward})` });

  addNotification(state, {
    userId: user.id,
    title: 'Report Attached & Under Consideration! 📎',
    body: `Thank you ${user.name}! We have linked your photo to ticket ${t.id} and you will be informed the moment it is solved.`,
    icon: '👍',
    isResolution: false,
    ticketId: t.id,
  });
  db.persist();
  res.json({ ticket: serializeTicket(t, req.userId) });
});

// POST /api/tickets/:id/escalate  multipart/form-data: photo (optional)
// "It got worse — escalate to urgent"
router.post('/:id/escalate', requireAuth, upload.single('photo'), (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  const state = db.load();
  const user = findUserById(req.userId);

  t.votes += 1;
  t.urgent = true;
  t.reports = t.reports || [];
  t.reports.push({ photoPath: req.file ? req.file.filename : null, createdAt: Date.now(), userLabel: `${user.name} (Urgent Hazard Escalation)` });

  addNotification(state, {
    userId: user.id,
    title: 'Urgent Hazard Escalated 🚨',
    body: `Thank you! Report ${t.id} has been boosted to Critical Priority and dispatched to the emergency team.`,
    icon: '⚡',
    isResolution: false,
    ticketId: t.id,
  });
  db.persist();
  res.json({ ticket: serializeTicket(t, req.userId) });
});

// ---------------------------------------------------------------------
// Upvote / resolve / rate
// ---------------------------------------------------------------------

// POST /api/tickets/:id/upvote — toggles the current user's vote
router.post('/:id/upvote', requireAuth, (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  const state = db.load();
  const already = state.ticketVotes.find((v) => v.ticketId === t.id && v.userId === req.userId);

  if (already) {
    state.ticketVotes = state.ticketVotes.filter((v) => v !== already);
    t.votes = Math.max(0, t.votes - 1);
  } else {
    state.ticketVotes.push({ ticketId: t.id, userId: req.userId });
    t.votes += 1;
  }
  db.persist();
  res.json({ ticket: serializeTicket(t, req.userId) });
});

// POST /api/tickets/:id/resolve — marks Completed and notifies the reporter
// (in this single-citizen demo the same user who reports also plays the
// "municipal crew" and clicks this button, exactly like the original mock).
router.post('/:id/resolve', requireAuth, (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  const state = db.load();
  const user = findUserById(req.userId);
  t.status = 'Completed';

  addNotification(state, {
    userId: t.reporterId || req.userId,
    title: 'Problem Solved! 🎉',
    body: `Good news ${user.name}! Your reported issue (${t.id} at ${t.loc.label}) is now fully resolved. Tap to rate the repair work!`,
    icon: '✅',
    isResolution: true,
    ticketId: t.id,
  });
  db.persist();
  res.json({ ticket: serializeTicket(t, req.userId) });
});

// POST /api/tickets/:id/rating { stars, chips, comment }
router.post('/:id/rating', requireAuth, (req, res) => {
  const t = findTicketOr404(req, res);
  if (!t) return;
  const { stars, chips, comment } = req.body;
  const s = parseInt(stars, 10);
  if (!s || s < 1 || s > 5) return res.status(400).json({ error: 'stars must be 1-5.' });

  t.rating = { stars: s, chips: Array.isArray(chips) ? chips : [], comment: comment || '' };
  db.persist();
  res.json({ ticket: serializeTicket(t, req.userId) });
});

module.exports = router;
