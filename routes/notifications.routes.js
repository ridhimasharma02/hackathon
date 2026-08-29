const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// GET /api/notifications — this user's device-notification history,
// newest first. Persisted server-side now (the original mock lost this
// log on every page refresh).
router.get('/', requireAuth, (req, res) => {
  const { notifications } = db.load();
  res.json({ notifications: notifications.filter((n) => n.userId === req.userId) });
});

// POST /api/notifications/read-all — clears the unread badge dot.
router.post('/read-all', requireAuth, (req, res) => {
  const state = db.load();
  state.notifications.forEach((n) => {
    if (n.userId === req.userId) n.read = true;
  });
  db.persist();
  res.json({ ok: true });
});

module.exports = router;
