// ===========================================================================
// Civic Lens — frontend
//
// This used to be an inline <script> with a hardcoded `tickets` array that
// reset on every page refresh. It now talks to the real backend in
// server.js over fetch()/FormData, and animates key interactions with
// Motion (https://motion.dev) instead of CSS-only transitions. See
// backend.txt for the full architecture writeup.
// ===========================================================================

import { animate, stagger, hover, press } from "https://cdn.jsdelivr.net/npm/motion@13.1.1/+esm";

// A gentle "ease-out-expo"-style curve — the same curve the original CSS
// used for the push banner — reused everywhere Motion animates something.
const EASE = [0.16, 1, 0.3, 1];

const TOKEN_KEY = 'civiclens_token';
const THEME_KEY = 'civiclens_theme';
const DELHI_CENTER = { lat: 28.6139, lng: 77.2090 };

let TOKEN = localStorage.getItem(TOKEN_KEY) || null;
let currentUser = null;
let ZONES_CONFIG = { categories: [], zones: [], dupThresholdMeters: 30 };

let currentLiveGps = { lat: 28.5676, lng: 77.2106, accuracy: 4, label: 'AIIMS Emergency Corridor (Live GPS)' };
let gpsLocked = true;
let draft = { cat: null, photoFile: null, photoPreview: null, urgent: false, loc: null, zone: null, estimatedScore: null, sla: null };

let notificationsLog = [];
let currentRatingTicket = null;
let selectedStar = 5;
let selectedChips = [];
let map, markersLayer;

// ---------------------------------------------------------------------
// Tiny fetch wrapper: attaches the JWT, JSON-encodes plain objects,
// passes FormData through untouched (for photo uploads), and throws a
// normal Error (with the server's message) on a non-2xx response.
// ---------------------------------------------------------------------
async function api(path, { method = 'GET', body = null, isForm = false } = {}) {
  const headers = {};
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  let fetchBody;
  if (body != null) {
    if (isForm) {
      fetchBody = body; // FormData sets its own Content-Type (with boundary)
    } else {
      headers['Content-Type'] = 'application/json';
      fetchBody = JSON.stringify(body);
    }
  }
  const res = await fetch(path, { method, headers, body: fetchBody });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty/non-JSON body */ }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function saveToken(t) { TOKEN = t; localStorage.setItem(TOKEN_KEY, t); }
function clearToken() { TOKEN = null; localStorage.removeItem(TOKEN_KEY); }

// ---------------------------------------------------------------------
// Modal open/close — animated with Motion instead of a CSS keyframe.
// ---------------------------------------------------------------------
function openModal(id) {
  const overlay = document.getElementById(id);
  const modal = overlay.querySelector('.modal');
  overlay.classList.add('show');
  animate(modal, { opacity: [0, 1], scale: [0.94, 1], y: [10, 0] }, { duration: 0.28, easing: EASE });
}
function closeModal(id) {
  const overlay = document.getElementById(id);
  const modal = overlay.querySelector('.modal');
  const anim = animate(modal, { opacity: [1, 0], scale: [1, 0.96], y: [0, 6] }, { duration: 0.18, easing: 'ease-in' });
  Promise.resolve(anim.finished).then(() => overlay.classList.remove('show'));
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.innerHTML = msg;
  clearTimeout(t._hideTimer);
  animate(t, { opacity: [0, 1], y: [16, 0] }, { duration: 0.3, easing: EASE });
  t._hideTimer = setTimeout(() => {
    animate(t, { opacity: [1, 0], y: [0, 12] }, { duration: 0.25, easing: 'ease-in' });
  }, 3000);
}

function categoryIcon(catKey) {
  const c = (ZONES_CONFIG.categories || []).find((x) => x.k === catKey);
  return c ? c.ic : '⚠️';
}

// ---------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------
async function boot() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'light');

  try {
    ZONES_CONFIG = await api('/api/zones');
  } catch (e) {
    console.warn('[civic-lens] could not load /api/zones', e);
  }
  buildCategoryGrid();
  wireStaticEventListeners();
  setupGestureFeedback();

  if (TOKEN) {
    try {
      const { user } = await api('/api/auth/me');
      await enterApp(user);
      return;
    } catch (e) {
      clearToken();
    }
  }
  showLoginView();
}

function showLoginView() {
  document.getElementById('loginView').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  animate('.login-shell', { opacity: [0, 1], y: [14, 0] }, { duration: 0.45, easing: EASE });
}

async function enterApp(user) {
  currentUser = user;
  document.getElementById('userNameLabel').textContent = currentUser.name;
  document.getElementById('avatarLetter').textContent = (currentUser.name[0] || 'C').toUpperCase();
  const wardParts = (currentUser.ward || '').split(' ');
  document.getElementById('userWardBadge').textContent = wardParts[0] + ' ' + (wardParts[1] || '');
  document.getElementById('confUser').textContent = `${currentUser.name} (${currentUser.ward})`;

  document.getElementById('loginView').style.display = 'none';
  document.getElementById('appShell').style.display = 'block';
  animate('header.top', { opacity: [0, 1], y: [-8, 0] }, { duration: 0.4, easing: EASE });
  animate('main', { opacity: [0, 1], y: [10, 0] }, { duration: 0.45, delay: 0.05, easing: EASE });

  toast(`👋 Welcome, <b>${currentUser.name}</b>! Registered to <b>${currentUser.ward}</b>`);
  initLiveGps();
  positionTabIndicator(true);
  window.addEventListener('resize', () => positionTabIndicator(true));

  await refreshNotifications();
  await renderTickets();
}

function logoutUser() {
  clearToken();
  currentUser = null;
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginView').style.display = 'flex';
  closeModal('profileOverlay');
  toast('Logged out successfully.');
}

// ---------------------------------------------------------------------
// Auth: method tabs, phone/OTP, email, Google demo, guest
// ---------------------------------------------------------------------
function wireStaticEventListeners() {
  const tabPhone = document.getElementById('tabPhone');
  const tabEmail = document.getElementById('tabEmail');
  const methodPhone = document.getElementById('method-phone');
  const methodEmail = document.getElementById('method-email');

  tabPhone.addEventListener('click', () => {
    tabPhone.classList.add('active'); tabEmail.classList.remove('active');
    methodPhone.style.display = 'block'; methodEmail.style.display = 'none';
  });
  tabEmail.addEventListener('click', () => {
    tabEmail.classList.add('active'); tabPhone.classList.remove('active');
    methodEmail.style.display = 'block'; methodPhone.style.display = 'none';
  });

  document.getElementById('sendOtpBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneNum').value.trim();
    const name = document.getElementById('citizenName').value.trim();
    const addr = document.getElementById('citizenAddress').value.trim();
    const err = document.getElementById('phoneErr');
    if (phone.length < 10 || !name || !addr) { err.classList.add('show'); return; }
    err.classList.remove('show');
    try {
      const result = await api('/api/auth/otp/request', { method: 'POST', body: { phone } });
      document.getElementById('otpBlock').style.display = 'block';
      document.getElementById('sendOtpBtn').textContent = 'Resend OTP';
      toast(result.devOtp ? `📲 OTP Sent! Demo code is <b>${result.devOtp}</b>` : '📲 OTP Sent to your device!');
      if (result.devOtp) document.getElementById('otpInput').value = result.devOtp;
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
    }
  });

  document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
    const phone = document.getElementById('phoneNum').value.trim();
    const otp = document.getElementById('otpInput').value.trim();
    const err = document.getElementById('otpErr');
    try {
      const { token, user } = await api('/api/auth/otp/verify', {
        method: 'POST',
        body: {
          phone, otp,
          name: document.getElementById('citizenName').value.trim() || 'Aditya Sharma',
          address: document.getElementById('citizenAddress').value.trim(),
          ward: document.getElementById('citizenWard').value,
          pincode: document.getElementById('citizenPincode').value.trim(),
        },
      });
      err.classList.remove('show');
      saveToken(token);
      await enterApp(user);
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
    }
  });

  document.getElementById('emailContinueBtn').addEventListener('click', async () => {
    const email = document.getElementById('emailInput').value.trim();
    const pass = document.getElementById('passInput').value;
    const addr = document.getElementById('emailCitizenAddress').value.trim();
    const err = document.getElementById('emailErr');
    try {
      const { token, user } = await api('/api/auth/email/login', { method: 'POST', body: { email, password: pass, address: addr } });
      err.classList.remove('show');
      saveToken(token);
      await enterApp(user);
    } catch (e) {
      err.textContent = e.message; err.classList.add('show');
    }
  });

  document.getElementById('googleBtn').addEventListener('click', async () => {
    toast('Signing in with Google Account…');
    try {
      const { token, user } = await api('/api/auth/demo-google', { method: 'POST' });
      saveToken(token);
      await enterApp(user);
    } catch (e) { toast(`⚠️ ${e.message}`); }
  });

  document.getElementById('guestBtn').addEventListener('click', async () => {
    try {
      const { token, user } = await api('/api/auth/guest', { method: 'POST' });
      saveToken(token);
      await enterApp(user);
    } catch (e) { toast(`⚠️ ${e.message}`); }
  });

  document.getElementById('logoutBtn').addEventListener('click', (e) => { e.stopPropagation(); logoutUser(); });

  document.getElementById('userChipBtn').addEventListener('click', () => {
    document.getElementById('profName').textContent = currentUser.name;
    document.getElementById('profContact').textContent = currentUser.contact || currentUser.email;
    document.getElementById('profAddress').textContent = currentUser.address;
    document.getElementById('profWard').textContent = currentUser.ward;
    openModal('profileOverlay');
  });
  document.getElementById('profileCloseBtn').addEventListener('click', () => closeModal('profileOverlay'));
  document.getElementById('profileLogoutBtn').addEventListener('click', () => { closeModal('profileOverlay'); logoutUser(); });

  // ---------------- Notifications ----------------
  document.getElementById('pushCloseBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('devicePushBanner').classList.remove('active');
  });
  const notifBellBtn = document.getElementById('notifBellBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  notifBellBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    notifDropdown.classList.toggle('show');
    document.getElementById('notifBadgeDot').classList.remove('show');
    await refreshNotifications();
  });
  document.getElementById('clearNotifsBtn').addEventListener('click', async () => {
    try { await api('/api/notifications/read-all', { method: 'POST' }); } catch (e) { /* ignore */ }
    notificationsLog = [];
    updateNotifDrawerUI();
    document.getElementById('notifBadgeDot').classList.remove('show');
  });
  document.addEventListener('click', (e) => {
    if (!notifDropdown.contains(e.target) && e.target !== notifBellBtn) notifDropdown.classList.remove('show');
  });

  // ---------------- Rating stars / chips ----------------
  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.addEventListener('click', () => updateStarUI(parseInt(btn.dataset.star, 10)));
  });
  document.querySelectorAll('.q-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      chip.classList.toggle('active');
      const val = chip.dataset.chip;
      selectedChips = selectedChips.includes(val) ? selectedChips.filter((x) => x !== val) : [...selectedChips, val];
    });
  });
  document.getElementById('submitRatingBtn').addEventListener('click', async () => {
    if (!currentRatingTicket) return;
    try {
      await api(`/api/tickets/${currentRatingTicket.id}/rating`, {
        method: 'POST',
        body: { stars: selectedStar, chips: [...selectedChips], comment: document.getElementById('ratingComment').value.trim() },
      });
      closeModal('ratingOverlay');
      toast(`⭐ Thank you for rating! <b>${selectedStar}/5 Stars</b> saved for <b>${currentRatingTicket.id}</b>.`);
      renderTickets();
      if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
    } catch (e) { toast(`⚠️ ${e.message}`); }
  });

  // ---------------- Nav / views ----------------
  document.querySelectorAll('nav.tabs button').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  // ---------------- GPS ----------------
  document.getElementById('demoGpsPicker').addEventListener('change', (e) => applyGpsPreset(e.target.value));
  document.getElementById('refreshGpsBtn').addEventListener('click', () => initLiveGps());

  // ---------------- Report flow: photo / urgent toggle ----------------
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    draft.photoFile = f;
    const reader = new FileReader();
    reader.onload = (ev) => {
      draft.photoPreview = ev.target.result;
      dropzone.classList.add('has-img');
      dropzone.innerHTML = `<img src="${draft.photoPreview}"><div style="position:absolute; bottom:10px; right:10px; background:rgba(0,0,0,.75); color:#fff; padding:4px 10px; border-radius:8px; font-size:11px; font-weight:700;">📍 GPS Geotagged</div>`;
      checkStep1();
    };
    reader.readAsDataURL(f);
  });

  const urgentToggle = document.getElementById('urgentToggle');
  const urgentSwitch = document.getElementById('urgentSwitch');
  urgentToggle.addEventListener('click', () => {
    draft.urgent = !draft.urgent;
    urgentSwitch.classList.toggle('on', draft.urgent);
  });

  document.getElementById('toStep2').addEventListener('click', runAiVerification);
  document.getElementById('submitReport').addEventListener('click', handleSubmitReport);
  document.getElementById('backToStart').addEventListener('click', resetToStep1);

  // ---------------- Track view toolbar ----------------
  document.getElementById('trackSearch').addEventListener('input', renderTickets);
  document.getElementById('trackSort').addEventListener('change', renderTickets);
  document.getElementById('trackFilterCat').addEventListener('change', renderTickets);
  document.getElementById('trackFilterZone').addEventListener('change', renderTickets);

  // ---------------- Map ----------------
  document.getElementById('locateMeBtn').addEventListener('click', () => {
    if (map && currentLiveGps) map.setView([currentLiveGps.lat, currentLiveGps.lng], 16);
  });

  // ---------------- Theme ----------------
  document.getElementById('themeToggleApp').addEventListener('click', toggleTheme);
  document.getElementById('themeToggleLogin').addEventListener('click', toggleTheme);

  // ---------------- AI Guide (Giraffe) ----------------
  wireAssistant();
}

// ---------------------------------------------------------------------
// Category grid (built from the server's /api/zones categories list)
// ---------------------------------------------------------------------
function buildCategoryGrid() {
  const catGrid = document.getElementById('catGrid');
  catGrid.innerHTML = '';
  (ZONES_CONFIG.categories || []).forEach((c) => {
    const b = document.createElement('button');
    b.className = 'cat-btn'; b.type = 'button';
    b.innerHTML = `<span class="ic">${c.ic}</span><span>${c.name}</span>`;
    b.addEventListener('click', () => {
      document.querySelectorAll('.cat-btn').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      draft.cat = c.k;
      checkStep1();
    });
    catGrid.appendChild(b);
  });
}

function checkStep1() {
  document.getElementById('toStep2').disabled = !(draft.cat && draft.photoFile && gpsLocked);
}

// ---------------------------------------------------------------------
// Nav tabs + view switching (Motion-animated)
// ---------------------------------------------------------------------
const VIEWS = ['report', 'track', 'map', 'dashboard'];

function positionTabIndicator(instant) {
  const nav = document.getElementById('navTabs');
  const indicator = document.getElementById('tabPillIndicator');
  const activeBtn = nav.querySelector('button.active');
  if (!nav || !indicator || !activeBtn) return;
  const navRect = nav.getBoundingClientRect();
  const btnRect = activeBtn.getBoundingClientRect();
  const targetX = btnRect.left - navRect.left - 5; // nav has 5px padding baked into the indicator's own `left`
  const targetW = btnRect.width;
  if (instant) {
    indicator.style.transition = 'none';
    indicator.style.transform = `translateX(${targetX}px)`;
    indicator.style.width = `${targetW}px`;
  } else {
    animate(indicator, { transform: `translateX(${targetX}px)`, width: `${targetW}px` }, { duration: 0.35, easing: EASE });
  }
}

function switchView(name) {
  VIEWS.forEach((v) => document.getElementById('view-' + v).classList.toggle('active', v === name));
  document.querySelectorAll('nav.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  positionTabIndicator(false);

  const activeEl = document.getElementById('view-' + name);
  animate(activeEl, { opacity: [0, 1], y: [10, 0] }, { duration: 0.35, easing: EASE });

  if (name === 'track') renderTickets();
  if (name === 'dashboard') renderDashboard();
  if (name === 'map') initOrUpdateMap();
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------
async function refreshNotifications() {
  if (!currentUser) return;
  try {
    const { notifications } = await api('/api/notifications');
    notificationsLog = notifications;
    updateNotifDrawerUI();
  } catch (e) { /* not signed in yet, or offline — leave the drawer as-is */ }
}

function updateNotifDrawerUI() {
  if (notificationsLog.some((n) => !n.read)) document.getElementById('notifBadgeDot').classList.add('show');
  const container = document.getElementById('notifList');
  if (notificationsLog.length === 0) {
    container.innerHTML = `<div style="padding:20px; text-align:center; color:var(--muted); font-size:13px;">No notifications yet</div>`;
    return;
  }
  container.innerHTML = notificationsLog.map((n) => `
    <div class="notif-item" data-notif-id="${n.id}">
      <h5>${n.title}</h5>
      <p>${n.body}</p>
      <small>⏱️ ${new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${n.isResolution ? '&middot; <b>Tap to Rate ⭐</b>' : ''}</small>
    </div>
  `).join('');

  container.querySelectorAll('.notif-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const n = notificationsLog.find((x) => String(x.id) === el.dataset.notifId);
      document.getElementById('notifDropdown').classList.remove('show');
      if (!n) return;
      if (n.isResolution && n.ticketId) {
        try { const { ticket } = await api(`/api/tickets/${n.ticketId}`); openRatingModal(ticket); } catch (e) { /* ticket may be gone */ }
      } else {
        switchView('track');
      }
    });
  });
}

function playNotificationChime(isResolution) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (isResolution) {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
      osc.start(); osc.stop(ctx.currentTime + 0.45);
    } else {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
      osc.start(); osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) { /* audio not available — silent no-op */ }
}

function triggerDeviceNotification(options) {
  const { title, body, icon, actionHint, onClick, isResolution } = options;
  playNotificationChime(isResolution);

  if ('Notification' in window && Notification.permission === 'granted') {
    try { const notif = new Notification(title, { body }); if (onClick) notif.onclick = onClick; } catch (e) { /* ignore */ }
  } else if ('Notification' in window && Notification.permission !== 'denied') {
    Notification.requestPermission();
  }

  const banner = document.getElementById('devicePushBanner');
  document.getElementById('pushIcon').textContent = icon || (isResolution ? '🎉' : '📝');
  document.getElementById('pushTitle').textContent = title;
  document.getElementById('pushBody').textContent = body;
  document.getElementById('pushHint').textContent = actionHint || (isResolution ? '⭐ Tap here to rate the repair work' : '📍 Tap to view live ticket progress');

  banner.classList.add('active');
  animate('#pushIcon', { scale: [0.4, 1.15, 1] }, { duration: 0.5, easing: EASE });
  clearTimeout(banner._timer);
  banner._timer = setTimeout(() => banner.classList.remove('active'), 6500);
  banner.onclick = (e) => {
    if (e.target.id === 'pushCloseBtn') return;
    banner.classList.remove('active');
    if (onClick) onClick();
  };

  refreshNotifications();
}

// ---------------------------------------------------------------------
// Rating modal
// ---------------------------------------------------------------------
function openRatingModal(ticket) {
  currentRatingTicket = ticket;
  selectedStar = 5;
  selectedChips = [];

  document.getElementById('ratingTicketId').textContent = ticket.id;
  document.getElementById('ratingTicketLoc').textContent = ticket.loc.label;
  document.getElementById('ratingModalTitle').textContent = `Problem Solved: ${ticket.category}! 🎉`;
  document.getElementById('ratingModalSub').textContent = `The repair work for ${ticket.id} (${ticket.loc.label}) has been completed. Don't forget to rate your experience and the repair quality!`;

  updateStarUI(5);
  document.querySelectorAll('.q-chip').forEach((c) => c.classList.remove('active'));
  document.getElementById('ratingComment').value = '';
  openModal('ratingOverlay');
}

function updateStarUI(val) {
  selectedStar = val;
  document.querySelectorAll('.star-btn').forEach((btn) => {
    btn.classList.toggle('active', parseInt(btn.dataset.star, 10) <= val);
  });
}

// ---------------------------------------------------------------------
// GPS
// ---------------------------------------------------------------------
function initLiveGps() {
  const title = document.getElementById('gpsTitle');
  const sub = document.getElementById('gpsSub');
  if (!navigator.geolocation) {
    setGpsState(true, 'Simulated fallback GPS Active', '🔒 Demo GPS (±4m)');
    return;
  }
  title.textContent = 'Acquiring High-Accuracy Satellite GPS…';
  sub.textContent = 'Requesting device coordinates for tamper-proof geotagging';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentLiveGps = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy || 6),
        label: `Live GPS Position (${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)})`,
      };
      setGpsState(true, `Active Geotag: ${currentLiveGps.label}`, `🔒 GPS Locked (±${currentLiveGps.accuracy}m)`);
    },
    () => setGpsState(true, `Simulated Location: ${currentLiveGps.label}`, '🔒 Demo GPS Locked (±5m)'),
    { enableHighAccuracy: true, timeout: 6000 }
  );
}

function setGpsState(locked, subText, badgeText) {
  gpsLocked = locked;
  const title = document.getElementById('gpsTitle');
  const sub = document.getElementById('gpsSub');
  const badge = document.getElementById('gpsBadge');
  if (title && sub && badge) {
    title.textContent = 'Live Device Location Active & Verified';
    sub.textContent = subText;
    badge.textContent = badgeText;
  }
  checkStep1();
}

function applyGpsPreset(val) {
  if (val === 'live') return initLiveGps();
  const presets = {
    hospital: { lat: 28.5674, lng: 77.2102, accuracy: 3, label: 'AIIMS Emergency Corridor (25m from Gate)', badge: '🏥 Hospital Zone GPS (±3m)', msg: 'GPS switched to <b>AIIMS Emergency Corridor</b>' },
    school: { lat: 28.6251, lng: 77.2181, accuracy: 4, label: 'DPS High School Main Crossing', badge: '🏫 School Zone GPS (±4m)', msg: 'GPS switched to <b>DPS High School Campus</b>' },
    traffic: { lat: 28.6381, lng: 77.2251, accuracy: 5, label: 'Outer Ring Road Junction Flyover', badge: '🚦 High Traffic GPS (±5m)', msg: 'GPS switched to <b>Outer Ring Road Junction</b>' },
    dup_pothole: { lat: 28.56755, lng: 77.21045, accuracy: 2, label: 'MG Road (12m from open Pothole ticket)', badge: '📍 30m Duplicate Zone (MG Road)', msg: 'GPS set within <b>12 meters</b> of an active Pothole report' },
    dup_sewer: { lat: 28.62485, lng: 77.21835, accuracy: 3, label: 'Park St (18m from open Sewer ticket)', badge: '📍 30m Duplicate Zone (Park St)', msg: 'GPS set within <b>18 meters</b> of an active Sewer report' },
  };
  const p = presets[val];
  if (!p) return;
  currentLiveGps = { lat: p.lat, lng: p.lng, accuracy: p.accuracy, label: p.label };
  setGpsState(true, p.label, p.badge);
  toast(p.msg);
}

// ---------------------------------------------------------------------
// Report flow — Step 2 (AI verification + server-side spatial analysis)
// ---------------------------------------------------------------------
function setSeg(n) {
  [1, 2, 3].forEach((num) => {
    const seg = document.getElementById('seg' + num);
    seg.className = 'seg' + (num < n ? ' done' : num === n ? ' now' : '');
    const inner = seg.querySelector('i');
    animate(inner, { width: num < n ? '100%' : num === n ? '50%' : '0%' }, { duration: 0.35, easing: EASE });
  });
}

async function runAiVerification() {
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = 'block';
  setSeg(2);
  document.querySelectorAll('#verifyList li').forEach((li) => (li.className = ''));

  draft.loc = { ...currentLiveGps };

  const analysisPromise = api('/api/tickets/analyze', {
    method: 'POST',
    body: { category: draft.cat, lat: draft.loc.lat, lng: draft.loc.lng, urgent: draft.urgent },
  }).catch((err) => { toast(`⚠️ ${err.message}`); return null; });

  const steps = ['gps', 'ai', 'blur', 'dup', 'priority'];
  let analysis = null;
  for (const key of steps) {
    await new Promise((r) => setTimeout(r, 400));
    if (key === 'priority') analysis = await analysisPromise;
    const li = document.querySelector(`#verifyList li[data-k="${key}"]`);
    if (key === 'priority' && analysis && analysis.zone) {
      li.classList.add('zone-alert');
      li.innerHTML = `<span class="chk">${analysis.zone.icon}</span> High Sensitivity: Within ${analysis.zone.distanceM}m of ${analysis.zone.name} (+${analysis.zone.bonus} Priority)`;
      continue;
    }
    li.classList.add('active');
    li.querySelector('.chk').textContent = '✓';
  }

  await new Promise((r) => setTimeout(r, 350));
  if (!analysis) analysis = await analysisPromise;

  draft.zone = analysis ? analysis.zone : null;
  draft.estimatedScore = analysis ? analysis.estimatedScore : null;
  draft.sla = analysis ? analysis.sla : null;

  if (analysis && analysis.duplicate) {
    showDuplicateModal(analysis.duplicate, analysis.distanceMeters);
  } else {
    goToStep3();
  }
}

async function submitTicketAction(path, photoFile) {
  const form = new FormData();
  if (photoFile) form.append('photo', photoFile);
  return api(path, { method: 'POST', body: form, isForm: true });
}

function showDuplicateModal(existing, distanceMeters) {
  const distText = distanceMeters != null ? `${distanceMeters} meters` : 'under 30 meters';
  document.getElementById('dupProximitySub').innerHTML = `Civic Lens detected an active <b>${existing.category}</b> issue only <b>${distText}</b> away from your live GPS spot. Let's combine power instead of creating a duplicate ticket!`;
  document.getElementById('dupMetaDistance').innerHTML = `📏 Distance: <b>${distText}</b> away`;
  document.getElementById('dupMetaVotes').innerHTML = `🧍 <b>${existing.votes}</b> Citizens have already supported`;

  const origThumb = document.getElementById('dupOriginalThumb');
  origThumb.innerHTML = existing.photo ? `<img src="${existing.photo}">` : categoryIcon(existing.category);

  document.getElementById('dupUserThumb').innerHTML = draft.photoPreview ? `<img src="${draft.photoPreview}">` : '📸';

  openModal('dupOverlay');

  document.getElementById('dupSupportBtn').onclick = async () => {
    try {
      await submitTicketAction(`/api/tickets/${existing.id}/support`, draft.photoFile);
      closeModal('dupOverlay');
      triggerDeviceNotification({
        title: 'Report Attached & Under Consideration! 📎',
        body: `Thank you ${currentUser.name}! We have linked your photo to ticket ${existing.id} and you will be informed the moment it is solved.`,
        icon: '👍', isResolution: false, onClick: () => switchView('track'),
      });
      toast(`🎉 Combined! Your photo and <b>+1 Upvote</b> were added to <b>${existing.id}</b>.`);
      resetToStep1();
      switchView('track');
    } catch (e) { toast(`⚠️ ${e.message}`); }
  };

  document.getElementById('dupEscalateBtn').onclick = async () => {
    try {
      await submitTicketAction(`/api/tickets/${existing.id}/escalate`, draft.photoFile);
      closeModal('dupOverlay');
      triggerDeviceNotification({
        title: 'Urgent Hazard Escalated 🚨',
        body: `Thank you! Report ${existing.id} has been boosted to Critical Priority and dispatched to the emergency team.`,
        icon: '⚡', isResolution: false, onClick: () => switchView('track'),
      });
      toast(`🚨 Escalated to <b>CRITICAL HAZARD</b>! Priority score boosted for <b>${existing.id}</b>.`);
      resetToStep1();
      switchView('track');
    } catch (e) { toast(`⚠️ ${e.message}`); }
  };

  document.getElementById('dupSeparateBtn').onclick = () => {
    closeModal('dupOverlay');
    goToStep3();
  };
}

function goToStep3() {
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-3').style.display = 'block';
  setSeg(3);
  animate('#step-3', { opacity: [0, 1], y: [8, 0] }, { duration: 0.3, easing: EASE });

  document.getElementById('confUser').textContent = `${currentUser.name} (${currentUser.ward})`;
  document.getElementById('confCat').textContent = draft.cat;
  document.getElementById('confLoc').textContent = draft.loc.label;
  document.getElementById('confZone').innerHTML = draft.zone ? `${draft.zone.icon} ${draft.zone.name} (+${draft.zone.bonus} Pts)` : 'Standard Residential';
  document.getElementById('confScore').textContent = draft.estimatedScore != null ? `${draft.estimatedScore}/100` : '—';
  document.getElementById('confSla').textContent = draft.sla || '—';
}

async function handleSubmitReport() {
  const btn = document.getElementById('submitReport');
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'Submitting…';
  try {
    const form = new FormData();
    form.append('category', draft.cat);
    form.append('lat', draft.loc.lat);
    form.append('lng', draft.loc.lng);
    form.append('label', draft.loc.label || '');
    form.append('urgent', draft.urgent ? 'true' : 'false');
    form.append('force', 'true'); // duplicate check already ran in Step 2 (/analyze)
    if (draft.photoFile) form.append('photo', draft.photoFile);

    const { ticket } = await api('/api/tickets', { method: 'POST', body: form, isForm: true });

    triggerDeviceNotification({
      title: 'Problem Taken into Consideration 📝',
      body: `Thank you ${currentUser.name} for sharing the problem with us! Ticket ${ticket.id} has been registered and you will be informed when it is solved.`,
      icon: '📸', isResolution: false, onClick: () => switchView('track'),
    });
    toast(`✅ Issue Submitted! Tracking ID: <b>${ticket.id}</b>`);
    resetToStep1();
    switchView('track');
  } catch (e) {
    toast(`⚠️ ${e.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

function resetToStep1() {
  draft = { cat: null, photoFile: null, photoPreview: null, urgent: false, loc: null, zone: null, estimatedScore: null, sla: null };
  document.querySelectorAll('.cat-btn').forEach((x) => x.classList.remove('sel'));
  const dropzone = document.getElementById('dropzone');
  dropzone.classList.remove('has-img');
  dropzone.innerHTML = `<span class="big-ic">📸</span><b>Tap to Capture or Upload Photo Evidence</b><div style="font-size:12px; margin-top:4px; color:var(--muted);">Image coordinates will be stamped with live high-accuracy GPS</div>`;
  document.getElementById('fileInput').value = '';
  document.getElementById('urgentSwitch').classList.remove('on');
  document.getElementById('toStep2').disabled = true;
  document.getElementById('step-1').style.display = 'block';
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-3').style.display = 'none';
  setSeg(1);
}

// ---------------------------------------------------------------------
// Track & Upvote view
// ---------------------------------------------------------------------
function renderTicketCard(t) {
  const priorityClass = t.score >= 80 ? 'is-critical' : t.score >= 50 ? 'is-high' : 'is-medium';
  const catIcon = categoryIcon(t.category);
  const reportCount = (t.reports && t.reports.length) || 1;

  const photoStackHtml = reportCount > 1 ? `
    <div class="photo-stack">
      <span>📎 <b>${reportCount}</b> Citizens attached photos:</span>
      <div class="stacked-thumbs">
        ${t.reports.slice(0, 4).map((r) => r.photo ? `<div class="st-thumb"><img src="${r.photo}"></div>` : `<div class="st-thumb">${catIcon}</div>`).join('')}
      </div>
    </div>` : '';

  const ratingBadge = t.rating ? `
    <div style="background:rgba(16,185,129,.12); color:var(--verified); padding:6px 12px; border-radius:10px; font-size:12px; font-weight:700; display:inline-flex; align-items:center; gap:6px; margin-top:8px;">
      <span>Citizen Rating: ${'★'.repeat(t.rating.stars)} (${t.rating.stars}/5)</span>
      ${t.rating.chips && t.rating.chips.length ? `&middot; <span>${t.rating.chips.join(', ')}</span>` : ''}
    </div>` : '';

  return `
    <div class="ticket ${priorityClass}">
      <div class="stub-main">
        <div class="stub-thumb">
          ${t.photo ? `<img src="${t.photo}">` : `<span>${catIcon}</span>`}
          ${reportCount > 1 ? `<span class="thumb-count">${reportCount}</span>` : ''}
        </div>
        <div class="stub-text">
          <div class="ticket-top">
            <span class="score-badge">Score: ${t.score}/100</span>
            <span class="pill ${t.status === 'Received' ? 'received' : t.status === 'Working On It' ? 'working' : 'completed'}">${t.status}</span>
            ${t.urgent ? '<span class="pill critical">⚠️ Hazard Flag</span>' : ''}
            ${t.zone ? `<span class="pill ${t.zone.type.toLowerCase()}">${t.zone.icon} ${t.zone.name}</span>` : ''}
            <span class="mono" style="font-size:12px; color:var(--muted); margin-left:auto;">${t.id}</span>
          </div>
          <h4>${t.category} &mdash; ${t.loc.label}</h4>
          <p class="loc">📍 Reported by ${t.reporterLabel || 'Verified Citizen'} &middot; Filed ${new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
          <p class="sla">⏱️ SLA Target: ${t.sla}</p>
          ${photoStackHtml}
          ${ratingBadge}
          <div class="stepper">
            <div class="st on"><div class="dot2"></div><span>Received</span></div>
            <div class="bar ${t.status !== 'Received' ? 'on' : ''}"></div>
            <div class="st ${t.status !== 'Received' ? 'on' : ''}"><div class="dot2"></div><span>Working</span></div>
            <div class="bar ${t.status === 'Completed' ? 'on' : ''}"></div>
            <div class="st ${t.status === 'Completed' ? 'on' : ''}"><div class="dot2"></div><span>Resolved</span></div>
          </div>
          <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap;">
            ${t.status !== 'Completed'
              ? `<button class="btn small success" data-solve="${t.id}" style="width:auto; font-size:12px; padding:6px 12px;">✅ Simulate Municipal Resolution (Triggers Rating Alert)</button>`
              : `<button class="btn small ghost" data-rate="${t.id}" style="width:auto; font-size:12px; padding:6px 12px;">⭐ Rate / Edit Review (${t.rating ? t.rating.stars + '★' : 'Rate Us'})</button>`}
          </div>
        </div>
      </div>
      <div class="stub-side">
        <div class="votes">${t.votes}</div>
        <div class="votes-label">Support</div>
        <button class="upvote-btn ${t.userUpvoted ? 'upvoted' : ''}" data-vote="${t.id}">${t.userUpvoted ? '✓ Upvoted' : '+1 Support'}</button>
      </div>
    </div>`;
}

function wireTicketCardEvents(container) {
  container.querySelectorAll('[data-vote]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { ticket } = await api(`/api/tickets/${btn.dataset.vote}/upvote`, { method: 'POST' });
        toast(ticket.userUpvoted ? `👍 Upvoted <b>${ticket.id}</b>! Priority score raised to <b>${ticket.score}</b>.` : `Vote removed from <b>${ticket.id}</b>.`);
      } catch (e) { toast(`⚠️ ${e.message}`); }
      renderTickets();
    });
  });
  container.querySelectorAll('[data-solve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { ticket } = await api(`/api/tickets/${btn.dataset.solve}/resolve`, { method: 'POST' });
        triggerDeviceNotification({
          title: 'Problem Solved! 🎉',
          body: `Good news ${currentUser.name}! Your reported issue (${ticket.id} at ${ticket.loc.label}) is now fully resolved. Tap to rate the repair work!`,
          icon: '✅', isResolution: true, actionHint: '⭐ Tap here to submit citizen rating', onClick: () => openRatingModal(ticket),
        });
        toast(`🎉 <b>${ticket.id}</b> marked Completed! Notification sent to user.`);
      } catch (e) { toast(`⚠️ ${e.message}`); }
      renderTickets();
      if (document.getElementById('view-dashboard').classList.contains('active')) renderDashboard();
    });
  });
  container.querySelectorAll('[data-rate]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { ticket } = await api(`/api/tickets/${btn.dataset.rate}`);
        openRatingModal(ticket);
      } catch (e) { toast(`⚠️ ${e.message}`); }
    });
  });
}

async function renderTickets() {
  const search = document.getElementById('trackSearch').value.trim();
  const sort = document.getElementById('trackSort').value;
  const cat = document.getElementById('trackFilterCat').value;
  const zone = document.getElementById('trackFilterZone').value;

  let data;
  try {
    const qs = new URLSearchParams({ search, sort, cat, zone });
    data = await api(`/api/tickets?${qs.toString()}`);
  } catch (e) { toast(`⚠️ Could not load tickets: ${e.message}`); return; }

  document.getElementById('openCountBadge').textContent = data.openCount;
  const container = document.getElementById('ticketList');

  if (data.tickets.length === 0) {
    container.innerHTML = `<div class="card" style="padding:40px; text-align:center; color:var(--muted);">No matching civic issues found.</div>`;
    return;
  }

  container.innerHTML = data.tickets.map(renderTicketCard).join('');
  wireTicketCardEvents(container);
  animate('.ticket', { opacity: [0, 1], y: [16, 0] }, { delay: stagger(0.05), duration: 0.4, easing: EASE });
}

// ---------------------------------------------------------------------
// Live Map view
// ---------------------------------------------------------------------
async function initOrUpdateMap() {
  if (!map) {
    map = L.map('mapview', { scrollWheelZoom: false }).setView([DELHI_CENTER.lat, DELHI_CENTER.lng], 13);
    L.tileLayer('https://a.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    markersLayer = L.layerGroup().addTo(map);

    (ZONES_CONFIG.zones || []).forEach((z) => {
      const color = z.type === 'Hospital' ? '#F43F5E' : z.type === 'School' ? '#8B5CF6' : '#F97316';
      L.circle([z.lat, z.lng], { radius: z.radius, color, weight: 1.5, fillColor: color, fillOpacity: 0.12 }).addTo(map);
      L.marker([z.lat, z.lng], {
        icon: L.divIcon({ className: '', html: `<div class="zone-marker" style="border-color:${color}">${z.icon}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
      }).bindPopup(`<b>${z.icon} ${z.name}</b><br><span style="color:#64748B;">High-Priority Zone (${z.radius}m sensitivity radius)</span>`).addTo(map);
    });
  }

  markersLayer.clearLayers();

  if (currentLiveGps) {
    L.marker([currentLiveGps.lat, currentLiveGps.lng], {
      icon: L.divIcon({ className: '', html: '<div class="you-are-here"><div class="yah-pulse"></div><div class="yah-dot"></div></div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      zIndexOffset: 1000,
    }).bindPopup(`<b>📍 Your Live GPS Location</b><br>${currentLiveGps.label}`).addTo(markersLayer);
  }

  let data;
  try { data = await api('/api/tickets?sort=priority'); } catch (e) { toast(`⚠️ Could not load map data: ${e.message}`); data = { tickets: [] }; }

  data.tickets.forEach((t) => {
    const pinColor = t.status === 'Completed' ? '#10B981' : t.score >= 80 ? '#EF4444' : t.score >= 50 ? '#F97316' : '#3B82F6';
    const catIcon = categoryIcon(t.category);
    const m = L.circleMarker([t.loc.lat, t.loc.lng], { radius: 10 + Math.min(t.votes, 8), color: '#fff', weight: 2.5, fillColor: pinColor, fillOpacity: 0.95 });
    m.bindPopup(`
      <div style="font-family:'Inter',sans-serif;">
        <b>${catIcon} ${t.category}</b> (Score: ${t.score}/100)<br>
        <span style="font-size:12px; color:#64748B;">${t.loc.label}</span><br>
        <b>${t.votes} Upvotes</b> &middot; Status: <b>${t.status}</b>
        ${t.status === 'Completed' ? '<br><span style="color:#10B981; font-weight:700;">✅ Resolved</span>' : ''}
      </div>`);
    m.addTo(markersLayer);
  });

  setTimeout(() => map.invalidateSize(), 100);
}

// ---------------------------------------------------------------------
// Priority Queue / Dashboard view
// ---------------------------------------------------------------------
function renderDispatchRow(t, idx) {
  const catIcon = categoryIcon(t.category);
  return `
    <tr style="border-bottom:1px solid var(--line);">
      <td style="padding:12px 10px; font-weight:800; font-family:'Space Grotesk'; font-size:15px;">#${idx + 1}</td>
      <td style="padding:12px 10px;"><b>${catIcon} ${t.category}</b><br><small style="color:var(--muted);">${t.loc.label}</small></td>
      <td style="padding:12px 10px;">${t.zone ? `<span class="pill ${t.zone.type.toLowerCase()}">${t.zone.icon} ${t.zone.name}</span>` : '<span style="color:var(--muted);">Standard</span>'}</td>
      <td style="padding:12px 10px; font-weight:700;">👍 ${t.votes}</td>
      <td style="padding:12px 10px;"><span class="score-badge">${t.score}/100</span></td>
      <td style="padding:12px 10px; font-weight:600; color:${t.status === 'Completed' ? 'var(--verified)' : t.score >= 80 ? 'var(--critical)' : 'var(--ink)'};">${t.status === 'Completed' ? '✅ Completed' : t.sla}</td>
      <td style="padding:12px 10px;">
        ${t.status !== 'Completed'
          ? `<button class="btn small success" data-dash-solve="${t.id}" style="width:auto; padding:6px 12px; font-size:11.5px;">Mark Fixed</button>`
          : `<span style="color:var(--verified); font-weight:700; font-size:12px;">★ ${t.rating ? t.rating.stars + '/5' : 'Resolved'}</span>`}
      </td>
    </tr>`;
}

function wireDispatchRowEvents(tbody) {
  tbody.querySelectorAll('[data-dash-solve]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const { ticket } = await api(`/api/tickets/${btn.dataset.dashSolve}/resolve`, { method: 'POST' });
        triggerDeviceNotification({
          title: 'Problem Solved! 🎉',
          body: `Good news ${currentUser.name}! Your reported issue (${ticket.id} at ${ticket.loc.label}) is now fully resolved. Tap to rate the repair work!`,
          icon: '✅', isResolution: true, actionHint: '⭐ Tap here to submit citizen rating', onClick: () => openRatingModal(ticket),
        });
        toast(`🎉 <b>${ticket.id}</b> marked Completed! Notification sent to user.`);
      } catch (e) { toast(`⚠️ ${e.message}`); }
      renderDashboard();
      renderTickets();
    });
  });
}

async function renderDashboard() {
  let stats, data;
  try {
    [stats, data] = await Promise.all([api('/api/dashboard/stats'), api('/api/tickets?sort=priority')]);
  } catch (e) { toast(`⚠️ Could not load dashboard: ${e.message}`); return; }

  document.getElementById('statTotal').textContent = stats.total;
  document.getElementById('statCritical').textContent = stats.critical;
  document.getElementById('statVotes').textContent = stats.totalVotes;
  document.getElementById('statAvgSla').textContent = `${stats.avgSlaHours}h`;

  const tbody = document.getElementById('dispatchTableBody');
  tbody.innerHTML = data.tickets.map((t, idx) => renderDispatchRow(t, idx)).join('');
  wireDispatchRowEvents(tbody);
  animate('#dispatchTableBody tr', { opacity: [0, 1] }, { delay: stagger(0.03), duration: 0.3 });
}

// ---------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = theme === 'dark' ? '☀️' : '🌙';
  const appToggle = document.getElementById('themeToggleApp');
  const loginToggle = document.getElementById('themeToggleLogin');
  if (appToggle) appToggle.textContent = icon;
  if (loginToggle) loginToggle.textContent = icon;
}
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// ---------------------------------------------------------------------
// AI Guide ("Giraffe") — a small rule-based FAQ helper, unchanged from
// the original mock. Wiring a real LLM here is a natural next step
// (see backend.txt), but was out of scope for this pass.
// ---------------------------------------------------------------------
function wireAssistant() {
  const apLauncher = document.getElementById('assistantLauncher');
  const apPanel = document.getElementById('assistantPanel');
  const apMessages = document.getElementById('apMessages');
  const apInput = document.getElementById('apInput');

  function apAdd(text, role) {
    const row = document.createElement('div');
    row.className = 'ap-msg ' + role;
    row.innerHTML = `<div class="bubble">${text}</div>`;
    apMessages.appendChild(row);
    apMessages.scrollTop = apMessages.scrollHeight;
  }

  apLauncher.addEventListener('click', () => {
    const isShowing = apPanel.style.display === 'flex';
    apPanel.style.display = isShowing ? 'none' : 'flex';
    if (!isShowing && apMessages.children.length === 0) {
      apAdd(`Hi ${currentUser ? currentUser.name : 'there'}! I'm Giraffe 🦒. ${currentUser ? `You're logged in with ${currentUser.ward}.` : ''} I monitor your GPS geotags, 30m duplicate matching, and resolution notifications. Ask me anything!`, 'assistant');
    }
  });
  document.getElementById('apClose').addEventListener('click', () => (apPanel.style.display = 'none'));

  function handleAssistantQuery(q) {
    if (!q.trim()) return;
    apAdd(q, 'user');
    apInput.value = '';
    const l = q.toLowerCase();
    setTimeout(() => {
      if (l.includes('login') || l.includes('account') || l.includes('address')) {
        apAdd(`You are signed in as ${currentUser.name} (${currentUser.contact || currentUser.email}). Your registered address is "${currentUser.address}" in ${currentUser.ward}. Click your profile avatar in the header to view or sign out!`, 'assistant');
      } else if (l.includes('notification') || l.includes('alert')) {
        apAdd('Device notifications fire automatically on report submission and when municipal crews resolve your problem. Click the bell icon 🔔 to view all received alerts!', 'assistant');
      } else if (l.includes('rate') || l.includes('rating') || l.includes('star')) {
        apAdd("When any ticket is resolved, citizens receive an interactive modal with 1-5 star ratings ⭐, quick feedback chips (e.g. 'Lightning Fast', 'Clean Repair'), and comment boxes!", 'assistant');
      } else if (l.includes('30') || l.includes('duplicate')) {
        apAdd('Within 30 meters, Civic Lens prompts you to combine your photo with +1 upvote instead of creating duplicate tickets.', 'assistant');
      } else {
        apAdd("I can help you navigate! Try asking: 'Show my registered address', 'How does priority scoring work?', or click 'Simulate Municipal Resolution' to test resolution alerts.", 'assistant');
      }
    }, 400);
  }

  document.getElementById('apSend').addEventListener('click', () => handleAssistantQuery(apInput.value));
  apInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAssistantQuery(apInput.value); });
}

// ---------------------------------------------------------------------
// Motion hover/press gesture feedback — applied once, only to elements
// that exist for the life of the page (nav, header, static form buttons,
// modal actions). Elements re-created on every renderTickets()/
// renderDashboard() (upvote/solve/rate buttons) intentionally keep their
// plain CSS :hover states instead — see backend.txt for why.
// ---------------------------------------------------------------------
const STATIC_INTERACTIVE_SELECTOR = [
  '#sendOtpBtn', '#verifyOtpBtn', '#emailContinueBtn', '#googleBtn', '#guestBtn',
  '#toStep2', '#submitReport', '#backToStart',
  '#dupSupportBtn', '#dupEscalateBtn', '#dupSeparateBtn',
  '#submitRatingBtn', '#profileCloseBtn', '#profileLogoutBtn', '#logoutBtn', '#userChipBtn',
  '#refreshGpsBtn', '#locateMeBtn', '#clearNotifsBtn', '#notifBellBtn',
  '#themeToggleApp', '#themeToggleLogin', '#apClose', '#apSend', '#assistantLauncher',
  '.method-tabs button', 'nav.tabs button', '.icon-btn', '.cat-btn',
].join(', ');

function setupGestureFeedback() {
  hover(STATIC_INTERACTIVE_SELECTOR, (el) => {
    const a = animate(el, { y: -2 }, { duration: 0.15, easing: EASE });
    return () => animate(el, { y: 0 }, { duration: 0.2, easing: EASE });
  });
  press(STATIC_INTERACTIVE_SELECTOR, (el) => {
    animate(el, { scale: 0.96 }, { duration: 0.1, easing: EASE });
    return () => animate(el, { scale: 1 }, { duration: 0.2, easing: EASE });
  });
}

// ---------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------
boot();
