require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { attachUser } = require('./middleware/auth');
const { CATEGORIES, CRITICAL_ZONES, DUP_THRESHOLD_METERS } = require('./utils/zones');

const authRoutes = require('./routes/auth.routes').router;
const ticketsRoutes = require('./routes/tickets.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const notificationsRoutes = require('./routes/notifications.routes');

const app = express();
const PORT = process.env.PORT || 5050;

db.load(); // create/seed data/db.json on boot

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(attachUser); // reads the Bearer token (if any) into req.userId, never rejects

// Uploaded photos, served as plain static files.
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------
app.get('/api/zones', (req, res) => {
  res.json({ categories: CATEGORIES, zones: CRITICAL_ZONES, dupThresholdMeters: DUP_THRESHOLD_METERS });
});
app.use('/api/auth', authRoutes);
app.use('/api/tickets', ticketsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ---------------------------------------------------------------------
// Static frontend — this is the "integrated" part: one server, one port,
// no CORS to configure between a separate frontend/backend origin.
// ---------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// ---------------------------------------------------------------------
// Error handling (multer errors — bad file type, too large — land here)
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(err.status || 400).json({ error: err.message || 'Something went wrong.' });
});

app.listen(PORT, () => {
  console.log(`\n  Civic Lens is running:  http://localhost:${PORT}\n`);
});
