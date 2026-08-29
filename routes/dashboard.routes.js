const express = require('express');
const db = require('../db');
const { calculatePriority } = require('../utils/priority');

const router = express.Router();

// GET /api/dashboard/stats — aggregate numbers for the Priority Queue view.
// Computed fresh on every request from the live ticket list (nothing here
// is a stored counter), so it always reflects the current state.
router.get('/stats', (req, res) => {
  const { tickets } = db.load();
  const scores = tickets.map((t) => calculatePriority(t));
  const totalVotes = tickets.reduce((acc, t) => acc + t.votes, 0);

  // Average time-to-resolution across tickets that have actually been
  // completed; falls back to a flat estimate when nothing's resolved yet
  // (mirrors the "28h" placeholder in the original static mock).
  const resolved = tickets.filter((t) => t.status === 'Completed');
  const avgSlaHours = resolved.length
    ? Math.round(resolved.reduce((acc, t) => acc + (Date.now() - t.createdAt) / 3600000, 0) / resolved.length)
    : 28;

  res.json({
    total: tickets.length,
    critical: scores.filter((s) => s >= 80).length,
    totalVotes,
    avgSlaHours,
  });
});

module.exports = router;
