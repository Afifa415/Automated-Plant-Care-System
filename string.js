const API_URL = 'http://localhost:5000/api';
let USE_BACKEND = false;
let currentUser  = null;

/* ─────────────────────────────────────────────────────
   BACKEND DETECTION
───────────────────────────────────────────────────── */
async function checkBackend() {
  try {
    const r = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) {
      USE_BACKEND = true;
      updateModeUI(true);
      return true;
    }
  } catch (e) { /* backend offline */ }
  USE_BACKEND = false;
  updateModeUI(false);
  return false;
}

function updateModeUI(online) {
  const badge  = document.getElementById('mode-badge');
  const btext  = document.getElementById('mode-badge-text');
  const sbpill = document.getElementById('sb-mode-pill');
  const tbmode = document.getElementById('topbar-mode');
  if (online) {
    badge.className    = 'mode-badge backend';
    btext.textContent  = '🐍 Python backend connected';
    sbpill.className   = 'mode-pill backend';
    sbpill.textContent = '⬤ Python backend';
    tbmode.className   = 'mode-indicator backend';
    tbmode.textContent = '⬤ Python backend';
    showBanner('🐍 Python backend connected at localhost:5000 — data stored in flora.db', true);
  } else {
    badge.className    = 'mode-badge local';
    btext.textContent  = '💾 Local mode (no server)';
    sbpill.className   = 'mode-pill local';
    sbpill.textContent = '⬤ local mode';
    tbmode.className   = 'mode-indicator local';
    tbmode.textContent = '💾 local mode';
  }
}

function showBanner(msg, online) {
  const b = document.getElementById('server-banner');
  b.className = online ? 'online' : 'offline';
  document.getElementById('banner-text').textContent = msg;
  document.getElementById('app').classList.add('has-banner');
  setTimeout(hideBanner, 6000);
}
function hideBanner() {
  document.getElementById('server-banner').className = 'hidden';
  document.getElementById('app').classList.remove('has-banner');
}

/* ─────────────────────────────────────────────────────
   LOCAL STORAGE  (fallback when no Python backend)
───────────────────────────────────────────────────── */
const LOCAL = {
  users()     { try { return JSON.parse(localStorage.getItem('flora_users') || '{}'); } catch { return {}; } },
  saveUsers(u){ localStorage.setItem('flora_users', JSON.stringify(u)); },
  session()   { return localStorage.getItem('flora_session'); },
  setSession(u){ localStorage.setItem('flora_session', u); },
  clearSession(){ localStorage.removeItem('flora_session'); },
};

function lhash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/* Seed default admin on first ever load */
(function seedLocal() {
  const u = LOCAL.users();
  if (!u.admin) {
    u.admin = { password: lhash('admin123'), created: new Date().toISOString() };
    LOCAL.saveUsers(u);
  }
})();

/* ─────────────────────────────────────────────────────
   AUTH  — sign in / register / logout / change-password
───────────────────────────────────────────────────── */
function switchTab(t) {
  ['login', 'register'].forEach(x => {
    document.getElementById('tab-' + x).classList.toggle('active', x === t);
    document.getElementById('panel-' + x).classList.toggle('active', x === t);
  });
  setAuthMsg('');
}

function setAuthMsg(txt, type = 'err') {
  const el = document.getElementById('auth-msg');
  el.textContent = txt;
  el.className   = 'auth-msg' + (txt ? ' ' + type : '');
}
function clearAuthMsg() { setAuthMsg(''); }

function togglePw(id, btn) {
  const inp = document.getElementById(id);
  inp.type   = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
}

function checkStrength(pw) {
  const bar = document.getElementById('pw-bar');
  const lbl = document.getElementById('pw-lbl');
  if (!pw) { bar.style.width = '0'; lbl.textContent = ''; return; }
  let s = 0;
  if (pw.length >= 4) s++;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  const L = [
    { w: '20%', c: '#f87171', t: 'Very weak' },
    { w: '40%', c: '#fb923c', t: 'Weak'      },
    { w: '60%', c: '#fbbf24', t: 'Fair'      },
    { w: '80%', c: '#a3e635', t: 'Good'      },
    { w: '100%',c: '#4ade80', t: 'Strong'    },
  ][Math.min(s, 4)];
  bar.style.cssText = `width:${L.w};background:${L.c};height:3px;border-radius:2px;transition:all .3s`;
  lbl.textContent   = L.t;
  lbl.style.color   = L.c;
}

/* Sign In */
async function doLogin() {
  const user = document.getElementById('li-user').value.trim();
  const pass = document.getElementById('li-pass').value;
  if (!user || !pass) { setAuthMsg('Please enter both username and password'); return; }

  if (USE_BACKEND) {
    try {
      const r = await fetch(`${API_URL}/auth/login`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const d = await r.json();
      if (!r.ok) { setAuthMsg(d.error || 'Login failed'); return; }
      currentUser = { username: d.username, created_at: d.created_at };
      enterApp(d.username);
    } catch (e) {
      setAuthMsg('⚠ Backend unreachable — switching to local mode', 'warn');
      USE_BACKEND = false; updateModeUI(false); doLogin();
    }
  } else {
    const users = LOCAL.users();
    if (!users[user]) { setAuthMsg('Username not found'); return; }
    if (users[user].password !== lhash(pass)) { setAuthMsg('Incorrect password'); return; }
    LOCAL.setSession(user);
    currentUser = { username: user, created_at: users[user].created };
    enterApp(user);
  }
}

/* Create Account */
async function doRegister() {
  const user = document.getElementById('re-user').value.trim();
  const pass = document.getElementById('re-pass').value;
  const conf = document.getElementById('re-conf').value;
  if (!user || !pass || !conf) { setAuthMsg('Please fill in all three fields'); return; }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(user)) { setAuthMsg('Username: 3–20 chars, letters/numbers/underscore'); return; }
  if (pass.length < 4)  { setAuthMsg('Password must be at least 4 characters'); return; }
  if (pass !== conf)    { setAuthMsg('Passwords do not match'); return; }

  if (USE_BACKEND) {
    try {
      const r = await fetch(`${API_URL}/auth/register`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass }),
      });
      const d = await r.json();
      if (!r.ok) { setAuthMsg(d.error || 'Registration failed'); return; }
      currentUser = { username: d.username };
      setAuthMsg('✅ Account created! Welcome, ' + user + '!', 'ok');
      setTimeout(() => enterApp(user), 700);
    } catch (e) {
      setAuthMsg('⚠ Backend unreachable — using local mode', 'warn');
      USE_BACKEND = false; updateModeUI(false); doRegister();
    }
  } else {
    const users = LOCAL.users();
    if (users[user]) { setAuthMsg('Username already taken — choose another'); return; }
    users[user] = { password: lhash(pass), created: new Date().toISOString() };
    LOCAL.saveUsers(users);
    LOCAL.setSession(user);
    currentUser = { username: user };
    setAuthMsg('✅ Welcome, ' + user + '!', 'ok');
    setTimeout(() => enterApp(user), 700);
  }
}

/* Logout */
async function doLogout() {
  if (USE_BACKEND) {
    await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
  } else {
    LOCAL.clearSession();
  }
  clearInterval(SIM.timer);
  location.reload();
}

/* Change Password */
async function doChangePassword() {
  const cur = document.getElementById('cp-cur').value;
  const np  = document.getElementById('cp-new').value;
  const cn  = document.getElementById('cp-cnf').value;
  const setM = (t, ok) => {
    const el = document.getElementById('chpw-msg');
    el.textContent = t;
    el.className   = 'modal-msg' + (t ? (ok ? ' ok' : ' err') : '');
  };
  if (!cur || !np || !cn) { setM('Fill in all three fields'); return; }
  if (np.length < 4)      { setM('New password must be at least 4 characters'); return; }
  if (np !== cn)          { setM('Passwords do not match'); return; }

  if (USE_BACKEND) {
    const r = await fetch(`${API_URL}/auth/change-password`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: cur, new_password: np, confirm_password: cn }),
    }).catch(() => null);
    if (!r || !r.ok) { const d = r ? await r.json() : {}; setM(d.error || 'Failed'); return; }
  } else {
    const users = LOCAL.users();
    const u     = LOCAL.session();
    if (users[u].password !== lhash(cur)) { setM('Current password is incorrect'); return; }
    users[u].password = lhash(np);
    LOCAL.saveUsers(users);
  }
  setM('✅ Password changed successfully!', true);
  setTimeout(() => closeModal('chpw-modal'), 1400);
}

/* Modal helpers */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.querySelectorAll('#' + id + ' input').forEach(i => (i.value = ''));
  const m = document.querySelector('#' + id + ' .modal-msg');
  if (m) { m.textContent = ''; m.className = 'modal-msg'; }
}

/* Enter the app after successful auth */
function enterApp(username) {
  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app').classList.add('show');
  document.getElementById('sb-avatar').textContent = username[0].toUpperCase();
  document.getElementById('sb-uname').textContent  = username;
  if (USE_BACKEND) document.getElementById('backend-api-card').style.display = 'block';
  SIM.init();
  SIM.start();
}

// 2. Show a loading spinner/overlay on DOMContentLoaded (sync, instant)
function showLoadingOverlay() {
  document.getElementById('loading-overlay').style.display = 'flex';
}
function hideLoadingOverlay() {
  document.getElementById('loading-overlay').style.display = 'none';
}
function showLoginPage() {
  document.getElementById('login-page').style.visibility = 'visible';
}
window.addEventListener('DOMContentLoaded', async () => {
  showLoadingOverlay(); // sync — shows instantly, no flash

  await checkBackend();

  if (USE_BACKEND) {
    const r = await fetch(`${API_URL}/auth/me`, { credentials: 'include' }).catch(() => null);
    if (r && r.ok) {
      const d = await r.json();
      currentUser = d;
      hideLoadingOverlay();
      enterApp(d.username); // now reveal dashboard
      return;
    }
  } else {
    const s = LOCAL.session();
    const users = LOCAL.users();
    if (s && users[s]) {
      currentUser = { username: s, created_at: users[s].created };
      hideLoadingOverlay();
      enterApp(s); // now reveal dashboard
      return;
    }
  }

  hideLoadingOverlay();
  showLoginPage(); // only now reveal login
});
  /* Enter-key shortcut on auth screen */
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    if (document.getElementById('auth-screen').style.display === 'none') return;
    document.getElementById('panel-login').classList.contains('active') ? doLogin() : doRegister();
  });

/* ─────────────────────────────────────────────────────
   PLANT DEFINITIONS  (same as backend PLANTS dict)
───────────────────────────────────────────────────── */
const PLANTS_DEF = [
  { id: 'p1', name: 'Monstera Deliciosa',  icon: '🌿', om: [40, 70], ot: [18, 27], ol: [300,  800] },
  { id: 'p2', name: 'Succulent Echeveria', icon: '🌵', om: [15, 35], ot: [15, 30], ol: [600, 1200] },
  { id: 'p3', name: 'Peace Lily',          icon: '🌸', om: [50, 75], ot: [18, 25], ol: [100,  400] },
];

/* ─────────────────────────────────────────────────────
   LOCAL SIMULATION  (used when no Python backend)
───────────────────────────────────────────────────── */
function rnd(a, b) { return a + Math.random() * (b - a); }
function gauss(m = 0, s = 1) {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function calcHealth(p, s) {
  const sc  = (v, lo, hi, r) => Math.max(0, 1 - Math.max(0, lo - v, v - hi) / r);
  const avg = (sc(s.moisture, p.om[0], p.om[1], 30) +
               sc(s.temp,     p.ot[0], p.ot[1], 10) +
               sc(s.light,    p.ol[0], p.ol[1], 400)) / 3;
  const pct = Math.round(avg * 100);
  return pct >= 75 ? { score: pct, label: 'Healthy',  color: '#4ade80' }
       : pct >= 45 ? { score: pct, label: 'Fair',     color: '#facc15' }
       :             { score: pct, label: 'Critical', color: '#f87171' };
}
function timeAgo(d) {
  const m = Math.round((Date.now() - new Date(d)) / 60000);
  return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago';
}

/* ─────────────────────────────────────────────────────
   SIM  — data layer wrapping backend OR local engine
───────────────────────────────────────────────────── */
const SIM = {
  localState: {}, localHist: {}, localAlerts: [], tick: 0, timer: null,
  /* cached from backend */
  plants: [], alerts: [],

  init() {
    PLANTS_DEF.forEach(p => {
      this.localState[p.id] = {
        moisture:    rnd(p.om[0] + 5, p.om[1] - 5),
        temp:        rnd(p.ot[0] + 1, p.ot[1] - 1),
        light:       rnd(p.ol[0] + 50, p.ol[1] - 50),
        watering:    false,
        lastWatered: new Date(Date.now() - rnd(3600000, 43200000)),
      };
      this.localHist[p.id] = [];
      for (let i = 0; i < 40; i++) this.localStep(p, true);
    });
  },

  localStep(p, silent = false) {
    const s = this.localState[p.id];
    this.tick++;
    const t = this.tick * 0.06;
    s.temp     = p.ot[0] + (p.ot[1] - p.ot[0]) * 0.5 + (p.ot[1] - p.ot[0]) * 0.35 * Math.sin(t * 0.25) + gauss(0, .3);
    s.light    = Math.max(0, (p.ol[0] + p.ol[1]) / 2 + (p.ol[1] - p.ol[0]) * 0.4 * Math.sin(t * 0.18) + gauss(0, 15));
    s.moisture = Math.max(0, Math.min(100, s.moisture - rnd(0.25, 0.7) + (s.watering ? 9 : 0)));

    const [lo, hi] = p.om;
    if (s.moisture < lo - 10 && !s.watering) {
      s.watering = true; s.lastWatered = new Date();
      if (!silent) this.localAlerts.unshift({ type: 'watering', msg: `💧 ${p.name} auto-watered (${s.moisture.toFixed(0)}%)`, time: new Date().toISOString() });
    }
    if (s.moisture > hi) s.watering = false;
    if (s.moisture < lo - 18 && !silent) this.localAlerts.unshift({ type: 'danger', msg: `⚠️ ${p.name} critically dry! (${s.moisture.toFixed(0)}%)`, time: new Date().toISOString() });

    const snap = {
      ts:       new Date().toISOString(),
      moisture: +s.moisture.toFixed(1),
      temp:     +s.temp.toFixed(1),
      light:    +s.light.toFixed(0),
      watering: s.watering,
      health:   calcHealth(p, s),
    };
    this.localHist[p.id].push(snap);
    if (this.localHist[p.id].length > 120) this.localHist[p.id].shift();
    return snap;
  },

  async start() { await this.refresh(); this.timer = setInterval(async () => { await this.refresh(); }, 4000); },

  async refresh() {
    if (USE_BACKEND) {
      try {
        const [pr, ar] = await Promise.all([
          fetch(`${API_URL}/plants`,  { credentials: 'include' }),
          fetch(`${API_URL}/alerts`,  { credentials: 'include' }),
        ]);
        if (pr.ok) this.plants = await pr.json();
        if (ar.ok) this.alerts = await ar.json();
        renderAll(); return;
      } catch (e) {
        console.warn('Backend unreachable — falling back to local');
        USE_BACKEND = false; updateModeUI(false);
      }
    }
    PLANTS_DEF.forEach(p => this.localStep(p));
    renderAll();
  },

  getPlants() {
    if (USE_BACKEND) return this.plants;
    return PLANTS_DEF.map(p => {
      const snap = this.localHist[p.id].slice(-1)[0];
      const s    = this.localState[p.id];
      return {
        id: p.id, name: p.name, icon: p.icon,
        optimal: { moisture: p.om, temp: p.ot, light: p.ol },
        watering: s.watering, last_watered: s.lastWatered.toISOString(),
        current: snap || { moisture: 50, temp: 22, light: 400, watering: false, health: { score: 70, label: 'Fair', color: '#facc15' } },
      };
    });
  },

  getAlerts() {
    if (USE_BACKEND) return this.alerts.map(a => ({ ...a, msg: a.msg || a.message }));
    return this.localAlerts.slice(0, 50);
  },

  async getHistory(pid) {
    if (USE_BACKEND) {
      const r = await fetch(`${API_URL}/plants/${pid}/history`, { credentials: 'include' }).catch(() => null);
      if (r && r.ok) return await r.json();
    }
    return this.localHist[pid] || [];
  },

  async waterPlant(pid) {
    if (USE_BACKEND) {
      await fetch(`${API_URL}/plants/${pid}/water`, { method: 'POST', credentials: 'include' }).catch(() => {});
      await this.refresh();
    } else {
      const p = PLANTS_DEF.find(x => x.id === pid);
      this.localState[pid].watering = true;
      this.localState[pid].lastWatered = new Date();
      this.localAlerts.unshift({ type: 'manual', msg: `💧 Manual watering: ${p.name}`, time: new Date().toISOString() });
      renderAll();
    }
  },
};

/* ─────────────────────────────────────────────────────
   RENDER HELPERS
───────────────────────────────────────────────────── */
let activePlant = null, detMetric = 'moisture', histMetric = 'moisture';
let detChart = null, histChrt = null, hlthChrt = null;

function waterPlant(pid) { if (pid) SIM.waterPlant(pid); }

function renderAll() {
  const plants = SIM.getPlants();
  renderStats(plants);
  renderCards(plants);
  renderPlantNav(plants);
  if (activePlant) renderDetail(plants);
  const alerts = SIM.getAlerts();
  const n = alerts.length;
  document.getElementById('alert-badge').textContent = n;
  document.getElementById('st-alerts').innerHTML    = n + '<em>⚠</em>';
  document.getElementById('page-sub').textContent   = 'Updated ' + new Date().toLocaleTimeString();
}

function renderStats(plants) {
  if (!plants.length) return;
  const avgH = Math.round(plants.reduce((s, p) => s + (p.current.health?.score || 0), 0) / plants.length);
  const avgM = Math.round(plants.reduce((s, p) => s + p.current.moisture, 0) / plants.length);
  const ok   = plants.filter(p => p.current.health?.label === 'Healthy').length;
  document.getElementById('st-health').innerHTML    = avgH + '<em>%</em>';
  document.getElementById('st-hlbl').textContent    = ok + ' healthy plant' + (ok !== 1 ? 's' : '');
  document.getElementById('st-moist').innerHTML     = avgM + '<em>%</em>';
}

function renderCards(plants) {
  const grid = document.getElementById('plants-grid');
  grid.innerHTML = '';
  plants.forEach(p => {
    const s = p.current, h = s.health || { score: 0, label: '—', color: '#888' };
    const om = p.optimal?.moisture || [40, 70];
    const mc = s.moisture < om[0] - 10 ? '#f87171' : s.moisture > om[1] + 5 ? '#fbbf24' : '#5cd65c';
    const c  = document.createElement('div');
    c.className = 'pcard'; c.onclick = () => showDetail(p.id);
    c.innerHTML = `
      <div class="pcard-top">
        <span style="font-size:30px">${p.icon}</span>
        <span class="hbadge" style="background:${h.color}1a;color:${h.color};border:1px solid ${h.color}33">
          ${h.score}% ${h.label}</span>
      </div>
      <div class="pcard-name">${p.name}</div>
      <div class="pcard-id">${p.id} · ${s.watering ? '💧 Watering' : 'Idle'}</div>
      <div class="srow"><span class="slabel">MOISTURE</span>
        <div class="sbar"><div class="sfill" style="width:${Math.min(100, s.moisture)}%;background:${mc}"></div></div>
        <span class="sval" style="color:${mc}">${s.moisture}%</span></div>
      <div class="srow"><span class="slabel">TEMP</span>
        <div class="sbar"><div class="sfill" style="width:${Math.min(100,(s.temp/40)*100)}%;background:#60a5fa"></div></div>
        <span class="sval">${s.temp}°C</span></div>
      <div class="srow"><span class="slabel">LIGHT</span>
        <div class="sbar"><div class="sfill" style="width:${Math.min(100,(s.light/1300)*100)}%;background:#fbbf24"></div></div>
        <span class="sval">${s.light}lx</span></div>
      <button class="water-btn ${s.watering ? 'watering-anim' : ''}"
        onclick="event.stopPropagation();waterPlant('${p.id}')">
        ${s.watering ? '💧 Watering…' : '💧 Water Now'}</button>`;
    grid.appendChild(c);
  });
}

function renderPlantNav(plants) {
  const nav = document.getElementById('plant-nav');
  nav.innerHTML = '';
  plants.forEach(p => {
    const h  = p.current.health || { score: 0, label: '—' };
    const el = document.createElement('div');
    el.className = 'pnav' + (activePlant === p.id ? ' active' : '');
    el.id        = 'pnav-' + p.id;
    el.onclick   = () => showDetail(p.id);
    el.innerHTML = `<span class="pico">${p.icon}</span>
      <div class="pinfo">
        <div class="pname">${p.name}</div>
        <div class="phlt">${h.score}% · ${h.label}</div>
      </div>
      <div class="dot" style="background:${p.watering ? '#60a5fa' : '#5cd65c'}"></div>`;
    nav.appendChild(el);
  });
}

function renderAlerts() {
  const alerts = SIM.getAlerts();
  const list   = document.getElementById('alert-list');
  if (!alerts.length) { list.innerHTML = '<div style="color:var(--text3);font-size:13px;padding:10px 0">✅ No alerts yet.</div>'; return; }
  list.innerHTML = alerts.map(a => `
    <div class="aitem ${a.type}">
      <div class="adot" style="background:${a.type === 'danger' ? '#f87171' : a.type === 'manual' ? '#d4a84b' : '#5cd65c'}"></div>
      <div>
        <div class="amsg">${a.msg || a.message || ''}</div>
        <div class="atime">${new Date(a.time || a.created_at).toLocaleString()}</div>
      </div>
    </div>`).join('');
}

function renderDetail(plants) {
  const plist = plants || SIM.getPlants();
  const p     = plist.find(x => x.id === activePlant); if (!p) return;
  const s = p.current, h = s.health || { score: 0, label: '—', color: '#888' };
  const om = p.optimal?.moisture || [40, 70];
  const ot = p.optimal?.temp     || [18, 27];
  const ol = p.optimal?.light    || [300, 800];
  document.getElementById('d-ico').textContent  = p.icon;
  document.getElementById('d-name').textContent = p.name;
  document.getElementById('d-sub').textContent  = `${p.id} · Last watered ${timeAgo(p.last_watered)}`;
  document.getElementById('page-title').textContent = p.name;

  const mOk = s.moisture >= om[0] && s.moisture <= om[1];
  const tOk = s.temp     >= ot[0] && s.temp     <= ot[1];
  const lOk = s.light    >= ol[0] && s.light    <= ol[1];
  document.getElementById('sbig').innerHTML = `
    <div class="sbig"><div class="si">💧</div>
      <div class="sv">${s.moisture}<span class="su">%</span></div>
      <div class="sl">Soil Moisture</div>
      <div class="ss" style="color:${mOk?'#4ade80':'#f87171'}">${mOk?'✓ Optimal':'⚠ Off range'}</div>
      <div style="font-size:9px;color:var(--text3);margin-top:3px">Target ${om[0]}–${om[1]}%</div></div>
    <div class="sbig"><div class="si">🌡️</div>
      <div class="sv">${s.temp}<span class="su">°C</span></div>
      <div class="sl">Temperature</div>
      <div class="ss" style="color:${tOk?'#4ade80':'#fbbf24'}">${tOk?'✓ Optimal':'⚠ Off range'}</div>
      <div style="font-size:9px;color:var(--text3);margin-top:3px">Target ${ot[0]}–${ot[1]}°C</div></div>
    <div class="sbig"><div class="si">☀️</div>
      <div class="sv">${s.light}<span class="su">lx</span></div>
      <div class="sl">Light Level</div>
      <div class="ss" style="color:${lOk?'#4ade80':'#fbbf24'}">${lOk?'✓ Optimal':'⚠ Off range'}</div>
      <div style="font-size:9px;color:var(--text3);margin-top:3px">Target ${ol[0]}–${ol[1]}lx</div></div>`;

  const issues = [];
  if (s.moisture < om[0] - 10) issues.push('critically low moisture — auto-watering active');
  else if (s.moisture < om[0]) issues.push('moisture slightly below optimal');
  else if (s.moisture > om[1]) issues.push('possible over-watering');
  if (s.temp  < ot[0]) issues.push('temperature below ideal');
  if (s.temp  > ot[1]) issues.push('temperature above ideal');
  if (s.light < ol[0]) issues.push('insufficient light');
  if (s.light > ol[1]) issues.push('excessive light');
  document.getElementById('ai-body').innerHTML =
    `<strong>${p.name}</strong> health: <strong style="color:${h.color}">${h.score}% — ${h.label}</strong>.<br>
    ${issues.length ? `Issues: <strong>${issues.join('; ')}</strong>. Monitor closely.` : 'All sensors within optimal range. Great care! 🌱'}<br><br>
    🌡 ${s.temp}°C &nbsp;|&nbsp; 💧 ${s.moisture}% &nbsp;|&nbsp; ☀️ ${s.light}lx &nbsp;|&nbsp;
    Auto-water: ${s.watering ? '<strong style="color:#5cd65c">ON</strong>' : 'OFF'}`;
  drawDetailChart();
}

async function renderProfile() {
  const plants = SIM.getPlants();
  let udata = { username: '—', created_at: '—', total_users: '—' };
  if (USE_BACKEND) {
    const r = await fetch(`${API_URL}/auth/me`, { credentials: 'include' }).catch(() => null);
    if (r && r.ok) udata = await r.json();
  } else {
    const u = LOCAL.session(), users = LOCAL.users(), info = users[u] || {};
    udata = { username: u, created_at: info.created || '—', total_users: Object.keys(users).length };
  }
  document.getElementById('prof-avatar').textContent = udata.username[0]?.toUpperCase() || '?';
  document.getElementById('prof-name').textContent   = udata.username;
  document.getElementById('prof-user').textContent   = udata.username;
  document.getElementById('prof-since').textContent  = udata.created_at ? new Date(udata.created_at).toLocaleDateString() : '—';
  document.getElementById('prof-total').textContent  = udata.total_users + ' registered';
  document.getElementById('prof-mode').textContent   = USE_BACKEND ? '🐍 Python Flask + SQLite' : '💾 localStorage (offline)';
  const pp = document.getElementById('prof-plants');
  pp.innerHTML = '';
  plants.forEach(p => {
    const h   = p.current.health || { score: 0, label: '—', color: '#888' };
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px;background:var(--bg3);border-radius:9px';
    div.innerHTML = `<span style="font-size:20px">${p.icon}</span>
      <div style="flex:1">
        <div style="font-size:13px">${p.name}</div>
        <div style="font-size:10px;color:var(--text3);font-family:DM Mono,monospace">${p.id}</div>
      </div>
      <span style="font-size:11px;padding:3px 9px;border-radius:10px;
        background:${h.color}1a;color:${h.color};font-family:DM Mono,monospace">${h.score}% ${h.label}</span>`;
    pp.appendChild(div);
  });
}

/* ─────────────────────────────────────────────────────
   CHARTS  (Chart.js)
───────────────────────────────────────────────────── */
const COPT = {
  responsive: true, maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: { backgroundColor: '#1a261a', titleColor: '#e8f0e8', bodyColor: '#9db89d', borderColor: '#2a3d2a', borderWidth: 1 },
  },
  scales: {
    x: { grid: { color: 'rgba(42,61,42,.5)' }, ticks: { color: '#6a876a', font: { family: 'DM Mono', size: 9 }, maxTicksLimit: 8 } },
    y: { grid: { color: 'rgba(42,61,42,.5)' }, ticks: { color: '#6a876a', font: { family: 'DM Mono', size: 9 } } },
  },
};

async function drawDetailChart() {
  if (!activePlant) return;
  const hist   = await SIM.getHistory(activePlant);
  const labels = hist.map(h => new Date(h.ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }));
  const data   = hist.map(h => h[detMetric]);
  const cols   = { moisture: '#5cd65c', temp: '#60a5fa', light: '#fbbf24' };
  const col    = cols[detMetric];
  if (detChart) detChart.destroy();
  const ctx = document.getElementById('detail-chart').getContext('2d');
  const g   = ctx.createLinearGradient(0, 0, 0, 190);
  g.addColorStop(0, col + '55'); g.addColorStop(1, col + '00');
  detChart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: col, backgroundColor: g, borderWidth: 2, pointRadius: 0, tension: .4, fill: true }] },
    options: COPT,
  });
}

async function drawHistCharts() {
  const hists = await Promise.all(PLANTS_DEF.map(p => SIM.getHistory(p.id)));
  const colors = ['#5cd65c', '#60a5fa', '#fbbf24'];
  const len    = Math.min(...hists.map(h => h.length));
  if (len === 0) return;
  const labels = hists[0].slice(-len).map(h => new Date(h.ts).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }));

  const ds1 = PLANTS_DEF.map((p, i) => ({
    label: p.name, data: hists[i].slice(-len).map(h => h[histMetric]),
    borderColor: colors[i], backgroundColor: colors[i] + '22', borderWidth: 2, pointRadius: 0, tension: .4, fill: true,
  }));
  if (histChrt) histChrt.destroy();
  histChrt = new Chart(document.getElementById('hist-chart').getContext('2d'), {
    type: 'line', data: { labels, datasets: ds1 },
    options: { ...COPT, plugins: { ...COPT.plugins, legend: { display: true, labels: { color: '#9db89d', font: { family: 'DM Mono', size: 10 }, boxWidth: 10 } } } },
  });

  const ds2 = PLANTS_DEF.map((p, i) => ({
    label: p.name, data: hists[i].slice(-len).map(h => h.health?.score || 0),
    borderColor: colors[i], backgroundColor: colors[i] + '22', borderWidth: 2, pointRadius: 0, tension: .4, fill: true,
  }));
  if (hlthChrt) hlthChrt.destroy();
  hlthChrt = new Chart(document.getElementById('health-chart').getContext('2d'), {
    type: 'line', data: { labels, datasets: ds2 },
    options: { ...COPT, plugins: { ...COPT.plugins, legend: { display: true, labels: { color: '#9db89d', font: { family: 'DM Mono', size: 10 }, boxWidth: 10 } } } },
  });
}

/* ─────────────────────────────────────────────────────
   NAVIGATION
───────────────────────────────────────────────────── */
function goPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.pnav').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  if (el) el.classList.add('active');
  const titles = { dashboard: 'Dashboard', alerts: 'Alerts', history: 'History', profile: 'Profile' };
  document.getElementById('page-title').textContent = titles[name] || name;
  activePlant = null;
  if (name === 'alerts')  renderAlerts();
  if (name === 'history') drawHistCharts();
  if (name === 'profile') renderProfile();
}

function showDetail(pid) {
  activePlant = pid;
  document.querySelectorAll('.pnav, .nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('pnav-' + pid)?.classList.add('active');
  document.getElementById('page-detail').classList.add('active');
  document.getElementById('page-title').textContent = PLANTS_DEF.find(p => p.id === pid)?.name || 'Plant';
  renderDetail();
}

function switchMetric(m, el) {
  detMetric = m;
  document.querySelectorAll('#page-detail .ctab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  drawDetailChart();
}

function switchHistMetric(m, el) {
  histMetric = m;
  document.querySelectorAll('#page-history .ctab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  drawHistCharts();
}