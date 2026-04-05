// ================================================================
//  SCHOOLBOOK — db.js
//  localStorage database. No server, no auth library.
//  Admin account: ID 00000000 / password: Admin@1234
// ================================================================

const DB = (() => {

  // ── SEED DATA ─────────────────────────────────────────────
  const ADMIN = {
    id:       '00000000',
    name:     'System Administrator',
    password: 'Admin@1234',
    role:     'admin',
    status:   'active',
    createdAt: '2025-01-01T00:00:00.000Z',
  };

  function _seed() {
    if (!localStorage.getItem('sb_users')) {
      localStorage.setItem('sb_users', JSON.stringify([ADMIN]));
    }
    if (!localStorage.getItem('sb_bookings'))     localStorage.setItem('sb_bookings',     JSON.stringify([]));
    if (!localStorage.getItem('sb_steps'))        localStorage.setItem('sb_steps',        JSON.stringify([]));
    if (!localStorage.getItem('sb_notifications'))localStorage.setItem('sb_notifications',JSON.stringify([]));
  }

  // ── RAW STORE ──────────────────────────────────────────────
  function _get(key)        { return JSON.parse(localStorage.getItem(key) || '[]'); }
  function _set(key, val)   { localStorage.setItem(key, JSON.stringify(val)); }

  // ── SESSION ────────────────────────────────────────────────
  function getSession()     { const s = localStorage.getItem('sb_session'); return s ? JSON.parse(s) : null; }
  function setSession(user) { localStorage.setItem('sb_session', JSON.stringify(user)); }
  function clearSession()   { localStorage.removeItem('sb_session'); }

  // ── USERS ──────────────────────────────────────────────────
  function getUsers()       { return _get('sb_users'); }

  function getUserById(id)  { return getUsers().find(u => u.id === id) || null; }

  function idExists(id)     { return getUsers().some(u => u.id === id); }

  function login(id, password) {
    const user = getUserById(id);
    if (!user) return { ok: false, msg: 'ID not found.' };
    if (user.password !== password) return { ok: false, msg: 'Incorrect password.' };
    if (user.status === 'pending')  return { ok: false, msg: 'Account pending admin approval.', pending: true };
    if (user.status === 'rejected') return { ok: false, msg: 'Account was rejected. Contact admin.' };
    return { ok: true, user };
  }

  function register(data) {
    // data: { id, name, password, role }
    if (!data.id.match(/^\d{8}$/)) return { ok: false, msg: 'ID must be exactly 8 digits.' };
    if (idExists(data.id))         return { ok: false, msg: 'ID already registered.' };
    if (data.password.length < 6)  return { ok: false, msg: 'Password must be at least 6 characters.' };
    if (!data.name.trim())         return { ok: false, msg: 'Name is required.' };

    const restricted = ['custodian','finance','president'].includes(data.role);
    const user = {
      id:        data.id,
      name:      data.name.trim(),
      password:  data.password,
      role:      data.role,
      status:    restricted ? 'pending' : 'active',
      createdAt: new Date().toISOString(),
    };
    const users = getUsers();
    users.push(user);
    _set('sb_users', users);
    return { ok: true, user };
  }

  function updateUser(id, updates) {
    const users = getUsers().map(u => u.id === id ? { ...u, ...updates } : u);
    _set('sb_users', users);
    // Update session if same user
    const sess = getSession();
    if (sess && sess.id === id) setSession({ ...sess, ...updates });
  }

  // ── BOOKINGS ───────────────────────────────────────────────
  function getBookings()      { return _get('sb_bookings'); }
  function getBookingById(id) { return getBookings().find(b => b.id === id) || null; }

  function getMyBookings(userId) {
    return getBookings().filter(b => b.userId === userId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }

  function getAllBookings() {
    return getBookings().sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }

  function createBooking(data) {
    const id = 'BK' + Date.now().toString(36).toUpperCase();
    const booking = { id, ...data, createdAt: new Date().toISOString() };
    const bookings = getBookings();
    bookings.push(booking);
    _set('sb_bookings', bookings);
    return booking;
  }

  function updateBooking(id, updates) {
    const bookings = getBookings().map(b => b.id === id ? { ...b, ...updates } : b);
    _set('sb_bookings', bookings);
  }

  function hasConflict(facility, date, start, end, excludeId = null) {
    return getBookings().some(b => {
      if (excludeId && b.id === excludeId) return false;
      if (b.facility !== facility || b.date !== date) return false;
      if (b.status === 'rejected') return false;
      return start < b.timeEnd && end > b.timeStart;
    });
  }

  // ── APPROVAL STEPS ─────────────────────────────────────────
  function getSteps()               { return _get('sb_steps'); }
  function getStepsForBooking(bkId) { return getSteps().filter(s => s.bookingId === bkId).sort((a,b)=>a.order-b.order); }

  function createSteps(steps) {
    const all = getSteps();
    steps.forEach(s => all.push({ ...s, id: 'ST' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,5) }));
    _set('sb_steps', all);
  }

  function updateStep(id, updates) {
    const steps = getSteps().map(s => s.id === id ? { ...s, ...updates, actedAt: new Date().toISOString() } : s);
    _set('sb_steps', steps);
  }

  function getPendingForRole(role) {
    const labelMap = {
      faculty:   'Faculty Approval',
      custodian: 'Property Custodian',
      finance:   'Finance Office',
      president: 'School President',
    };
    const label = labelMap[role];
    if (!label) return [];

    const pendingSteps = getSteps().filter(s => s.label === label && s.status === 'pending');
    const bookings = getBookings();
    const allSteps = getSteps();

    return pendingSteps.filter(step => {
      const bkSteps = allSteps.filter(s => s.bookingId === step.bookingId).sort((a,b)=>a.order-b.order);
      // All prior non-skipped steps must be approved
      return bkSteps
        .filter(s => s.order < step.order && s.status !== 'skipped')
        .every(s => s.status === 'approved');
    }).map(step => ({
      step,
      booking: bookings.find(b => b.id === step.bookingId),
    })).filter(x => x.booking);
  }

  function getHistoryForRole(role) {
    const labelMap = {
      faculty:   'Faculty Approval',
      custodian: 'Property Custodian',
      finance:   'Finance Office',
      president: 'School President',
    };
    const label = labelMap[role];
    if (!label) return [];

    const bookings = getBookings();
    return getSteps()
      .filter(s => s.label === label && (s.status === 'approved' || s.status === 'rejected'))
      .sort((a,b) => (b.actedAt||'').localeCompare(a.actedAt||''))
      .map(step => ({ step, booking: bookings.find(b => b.id === step.bookingId) }))
      .filter(x => x.booking);
  }

  function actOnStep(stepId, action, note) {
    const step = getSteps().find(s => s.id === stepId);
    if (!step) return;
    updateStep(stepId, { status: action, note: note || (action === 'approved' ? 'Approved.' : 'Rejected.') });

    const bkSteps = getStepsForBooking(step.bookingId).map(s => s.id === stepId ? { ...s, status: action } : s);

    if (action === 'rejected') {
      // Skip remaining pending steps
      bkSteps.filter(s => s.status === 'pending' && s.id !== stepId)
        .forEach(s => updateStep(s.id, { status: 'skipped', note: 'Previous step was rejected.', actedAt: new Date().toISOString() }));
      updateBooking(step.bookingId, { status: 'rejected' });
    } else {
      const nextPending = bkSteps.find(s => s.order > step.order && s.status === 'pending');
      if (nextPending) {
        updateBooking(step.bookingId, { status: 'inreview', currentStep: nextPending.order });
      } else {
        updateBooking(step.bookingId, { status: 'approved', currentStep: bkSteps.length });
      }
    }
  }

  // ── NOTIFICATIONS ──────────────────────────────────────────
  function getNotifs(userId) {
    return _get('sb_notifications')
      .filter(n => n.userId === userId)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 25);
  }

  function addNotif(userId, message) {
    const notifs = _get('sb_notifications');
    notifs.push({ id: 'N'+Date.now(), userId, message, read: false, createdAt: new Date().toISOString() });
    _set('sb_notifications', notifs);
  }

  function markNotifsRead(userId) {
    const notifs = _get('sb_notifications').map(n => n.userId === userId ? { ...n, read: true } : n);
    _set('sb_notifications', notifs);
  }

  // ── INIT ────────────────────────────────────────────────────
  _seed();

  return {
    getSession, setSession, clearSession,
    getUsers, getUserById, idExists, login, register, updateUser,
    getBookings, getBookingById, getMyBookings, getAllBookings,
    createBooking, updateBooking, hasConflict,
    getSteps, getStepsForBooking, createSteps, updateStep,
    getPendingForRole, getHistoryForRole, actOnStep,
    getNotifs, addNotif, markNotifsRead,
  };
})();

// ================================================================
//  UTILITIES
// ================================================================

function requireAuth(roles = null) {
  const user = DB.getSession();
  if (!user) { location.href = 'index.html'; return null; }
  if (user.status === 'pending') { location.href = 'pending.html'; return null; }
  if (roles && !roles.includes(user.role)) { location.href = 'dashboard.html'; return null; }
  return user;
}

function logout() { DB.clearSession(); location.href = 'index.html'; }

function fmtDate(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
}
function fmtDT(s) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtTime(t) {
  if (!t) return '—';
  const [h,m] = t.split(':').map(Number);
  return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
}

function badge(status) {
  const map = {
    pending:  ['badge-pending',  'PENDING'],
    inreview: ['badge-inreview', 'IN REVIEW'],
    approved: ['badge-approved', 'APPROVED'],
    rejected: ['badge-rejected', 'REJECTED'],
    skipped:  ['badge-skipped',  'N/A'],
  };
  const [cls, lbl] = map[status] || ['badge-pending', status.toUpperCase()];
  return `<span class="badge ${cls}">${lbl}</span>`;
}

function roleBadge(role) {
  return `<span class="role ${role}">${role.toUpperCase()}</span>`;
}

function stepDotClass(s) {
  if (s === 'approved' || s === 'skipped') return 'done';
  if (s === 'rejected') return 'rejected';
  return 'pending';
}
function stepDotIcon(s) {
  if (s === 'approved' || s === 'skipped') return '✓';
  if (s === 'rejected') return '✕';
  return '·';
}

function toast(msg, type='ok') {
  const wrap = document.getElementById('toast-wrap');
  if (!wrap) return;
  const icons = { ok:'[OK]', err:'[ERR]', warn:'[WARN]' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span style="color:${type==='ok'?'var(--green)':type==='err'?'var(--danger)':'var(--warning)'};">${icons[type]}</span> ${msg}`;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

function renderNav(user) {
  const roleNav = {
    admin:    ['dashboard.html','admin.html'],
    student:  ['dashboard.html','book.html','my-bookings.html','calendar.html'],
    faculty:  ['dashboard.html','book.html','my-bookings.html','approvals.html','calendar.html'],
    custodian:['dashboard.html','approvals.html','calendar.html'],
    finance:  ['dashboard.html','approvals.html','calendar.html'],
    president:['dashboard.html','approvals.html','calendar.html','admin.html'],
  };
  const labels = {
    'dashboard.html':'~/dashboard','book.html':'~/book',
    'my-bookings.html':'~/my-bookings','approvals.html':'~/approvals',
    'calendar.html':'~/calendar','admin.html':'~/admin',
  };
  const links = roleNav[user.role] || roleNav.student;
  const cur   = location.pathname.split('/').pop();
  const notifs = DB.getNotifs(user.id);
  const unread = notifs.filter(n=>!n.read).length;
  const initials = user.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();

  return `
    <nav class="navbar">
      <a href="dashboard.html" class="nav-brand">SCHOOLBOOK<div class="cursor"></div></a>
      <div class="nav-links">
        ${links.map(h=>`<a href="${h}" class="${cur===h?'active':''}">${labels[h]||h}</a>`).join('')}
      </div>
      <div class="nav-right">
        <button id="notif-btn" onclick="_toggleNotifs()" style="background:transparent;border:1px solid var(--green4);border-radius:var(--radius);padding:4px 10px;cursor:pointer;font-family:var(--mono);font-size:.72rem;color:var(--text2);position:relative;transition:all .15s;"
          onmouseover="this.style.borderColor='var(--green3)';this.style.color='var(--green)'"
          onmouseout="this.style.borderColor='var(--green4)';this.style.color='var(--text2)'">
          NOTIF${unread>0?` <span style="background:var(--green);color:var(--black);border-radius:3px;padding:1px 5px;font-size:.65rem;">${unread}</span>`:''}
        </button>
        <div class="nav-id">ID: <span>${user.id}</span> ${roleBadge(user.role)}</div>
        <div class="avatar-btn" onclick="logout()" title="Logout (${user.name})">${initials}</div>
      </div>
    </nav>
    <div class="notif-panel" id="notif-panel">
      <div class="notif-head">
        <span>// notifications</span>
        <button onclick="_markRead()" style="background:transparent;border:none;cursor:pointer;font-family:var(--mono);font-size:.68rem;color:var(--text3);">MARK READ</button>
      </div>
      <div class="notif-list" id="notif-list"></div>
    </div>
    <div class="toast-wrap" id="toast-wrap"></div>
  `;
}

function initNotifPanel(user) {
  const notifs = DB.getNotifs(user.id);
  const list = document.getElementById('notif-list');
  if (!list) return;
  if (!notifs.length) {
    list.innerHTML = '<div class="empty" style="padding:1.2rem;"><div class="empty-sub">No notifications.</div></div>';
    return;
  }
  list.innerHTML = notifs.map(n=>`
    <div class="notif-item ${n.read?'':'unread'}">
      <div>${n.message}</div>
      <div class="ntime">${fmtDT(n.createdAt)}</div>
    </div>
  `).join('');
}

window._toggleNotifs = function() {
  const p = document.getElementById('notif-panel');
  p.classList.toggle('open');
};
window._markRead = function() {
  const u = DB.getSession();
  if (u) DB.markNotifsRead(u.id);
  const p = document.getElementById('notif-panel');
  p.querySelectorAll('.notif-item').forEach(el=>el.classList.remove('unread'));
};
window.logout = logout;

document.addEventListener('click', e => {
  const p = document.getElementById('notif-panel');
  const btn = document.getElementById('notif-btn');
  if (p && p.classList.contains('open') && !p.contains(e.target) && btn && !btn.contains(e.target))
    p.classList.remove('open');
});
