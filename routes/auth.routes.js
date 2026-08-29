const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const db = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes, matches the original UX

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...safe } = u;
  return safe;
}

function findUserById(id) {
  const state = db.load();
  return state.users.find((u) => u.id === id);
}

// ---------------------------------------------------------------------
// Mobile OTP flow
// ---------------------------------------------------------------------

// POST /api/auth/otp/request { phone }
// No real SMS gateway is wired up (that's a paid third-party integration,
// out of scope for a hackathon) — instead we generate a real one-time
// code, hold it server-side for 5 minutes, and log it to the server
// console so a judge/demo can read it there. The frontend never sees the
// code unless NODE_ENV !== 'production', to keep the shape of the flow
// realistic.
router.post('/otp/request', (req, res) => {
  const phone = String(req.body.phone || '').trim();
  if (phone.length < 10) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  }
  const state = db.load();
  const code = String(Math.floor(1000 + Math.random() * 9000));
  state.otps[phone] = { code, expiresAt: Date.now() + OTP_TTL_MS };
  db.persist();

  console.log(`[otp] ${phone} -> ${code} (expires in 5 min)`);

  res.json({
    ok: true,
    message: 'OTP sent to your device.',
    // Only exposed outside production so the demo remains self-contained.
    devOtp: process.env.NODE_ENV === 'production' ? undefined : code,
  });
});

// POST /api/auth/otp/verify { phone, otp, name, address, ward, pincode }
router.post('/otp/verify', (req, res) => {
  const { phone, otp, name, address, ward, pincode } = req.body;
  const state = db.load();
  const record = state.otps[String(phone || '').trim()];

  if (!record || record.code !== String(otp || '').trim() || Date.now() > record.expiresAt) {
    return res.status(400).json({ error: 'Invalid or expired code — request a new OTP.' });
  }
  delete state.otps[phone];

  let user = state.users.find((u) => u.phone === phone);
  if (!user) {
    user = {
      id: uuidv4(),
      name: name || 'Citizen',
      contact: '+91 ' + phone,
      phone,
      email: null,
      passwordHash: null,
      address: address || '',
      ward: ward || 'Ward 14 (South Zone)',
      pincode: pincode || '',
      isGuest: false,
      createdAt: Date.now(),
    };
    state.users.push(user);
  } else {
    // Registered before — refresh profile fields in case they changed them.
    Object.assign(user, { name: name || user.name, address: address || user.address, ward: ward || user.ward, pincode: pincode || user.pincode });
  }
  db.persist();

  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------------------------------------------------------------------
// Email / password flow
// ---------------------------------------------------------------------

// POST /api/auth/email/register { name, email, password, address, ward, pincode }
router.post('/email/register', async (req, res) => {
  const { name, email, password, address, ward, pincode } = req.body;
  if (!email || !String(email).includes('@') || !password || password.length < 3) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }
  const state = db.load();
  if (state.users.find((u) => u.email === email)) {
    return res.status(409).json({ error: 'An account with this email already exists — try logging in instead.' });
  }
  const user = {
    id: uuidv4(),
    name: name || email.split('@')[0],
    contact: email,
    phone: null,
    email,
    passwordHash: await bcrypt.hash(password, 10),
    address: address || '',
    ward: ward || 'Ward 14 (South Zone)',
    pincode: pincode || '',
    isGuest: false,
    createdAt: Date.now(),
  };
  state.users.push(user);
  db.persist();
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/email/login { email, password }
// Convenience: if no account exists yet for this email, we register it on
// the fly (mirrors the original mock, which never actually rejected a
// login) — but only for a *first* login; a wrong password on an existing
// account is rejected.
router.post('/email/login', async (req, res) => {
  const { email, password, address } = req.body;
  if (!email || !String(email).includes('@') || !password || password.length < 3) {
    return res.status(400).json({ error: 'Enter a valid email and password.' });
  }
  const state = db.load();
  let user = state.users.find((u) => u.email === email);

  if (user) {
    const ok = await bcrypt.compare(password, user.passwordHash || '');
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
  } else {
    user = {
      id: uuidv4(),
      name: email.split('@')[0].replace('.', ' ').toUpperCase(),
      contact: email,
      phone: null,
      email,
      passwordHash: await bcrypt.hash(password, 10),
      address: address || 'Green Park Extension, Ward 14',
      ward: 'Ward 14 (South Zone)',
      pincode: '',
      isGuest: false,
      createdAt: Date.now(),
    };
    state.users.push(user);
  }
  db.persist();
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---------------------------------------------------------------------
// Demo-only shortcuts (no real OAuth wired up — see backend.txt)
// ---------------------------------------------------------------------

// POST /api/auth/demo-google — simulates the "1-Click Continue with
// Google" button from the mock. Always resolves to the same demo
// account so the flow is deterministic. Wiring real Google OAuth is a
// documented next step in backend.txt.
router.post('/demo-google', (req, res) => {
  const state = db.load();
  const email = 'alex.kapoor@gmail.com';
  let user = state.users.find((u) => u.email === email);
  if (!user) {
    user = {
      id: uuidv4(),
      name: 'Alex Kapoor',
      contact: '+91 98112 34567',
      phone: null,
      email,
      passwordHash: null,
      address: 'B-14, Green Park Extension, Ward 14',
      ward: 'Ward 14 (South Zone)',
      pincode: '110016',
      isGuest: false,
      createdAt: Date.now(),
    };
    state.users.push(user);
    db.persist();
  }
  res.json({ token: signToken(user), user: publicUser(user) });
});

// POST /api/auth/guest — a fresh, unverified, throwaway citizen account.
router.post('/guest', (req, res) => {
  const state = db.load();
  const user = {
    id: uuidv4(),
    name: 'Anonymous Citizen',
    contact: 'Unverified Guest',
    phone: null,
    email: null,
    passwordHash: null,
    address: 'Near Reported GPS Location',
    ward: 'Ward 14 (South Zone)',
    pincode: '',
    isGuest: true,
    createdAt: Date.now(),
  };
  state.users.push(user);
  db.persist();
  res.json({ token: signToken(user), user: publicUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = findUserById(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found — please sign in again.' });
  res.json({ user: publicUser(user) });
});

module.exports = { router, publicUser, findUserById };
