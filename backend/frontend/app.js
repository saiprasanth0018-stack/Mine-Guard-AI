/* ═══════════════════════════════════════════════════════════════════
   MINEGUARD AI — app.js
   Part 1/7 · Config, state, utilities, IST clock, REST client
   SIH26039 · Team LABELX · Jharia Seam XI · RL −480 m
═══════════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────── CONFIG ─────────────── */
const API_BASE = '';                          // same-origin (Flask serves both)
const POLL_NORMAL_MS = 2000;                  // 2 s in normal mode
const POLL_EMERGENCY_MS = 1000;               // 1 s in emergency mode
const IST_TIMEZONE = 'Asia/Kolkata';
const STALE_THRESHOLD_MS = 10000;             // >10 s no update → UNKNOWN
const MAX_ALERTS = 60;
const MAX_TIMELINE = 200;

/* ─────────────── GLOBAL STATE ─────────────── */
const MG = {
  booted: false,
  emergency: false,
  emergencyId: null,
  emergencyStartTs: null,
  voiceEnabled: true,
  soundEnabled: true,
  currentPage: 'dashboard',
  pollingHandle: null,
  clockHandle: null,

  /* live data cache — populated by polling */
  sensors: {},
  sensorMeta: {},
  workers: [],
  vehicles: [],
  rover: {
    status: 'STANDBY',
    location: 'Surface Station',
    battery: 100,
    comms: 'CONNECTED',
    ch4: 0.22,
    thermal: 34.0,
    humidity: 72,
    obstacle: 'CLEAR'
  },
  comms: { state: 'CONNECTED', signal: 91, latency: 42 },
  ai: { score: 14, level: 'LOW', gas: 20, vent: 20, strata: 20, prox: 20, recommendation: 'Continue routine monitoring.' },
  alerts: [],
  timeline: [],
  areas: {},
  lastPollAt: 0,
  lastSensorUpdateAt: 0
};

/* ─────────────── UTILITIES ─────────────── */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
}

const pad2 = n => String(n).padStart(2, '0');
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmt1 = n => Number(n).toFixed(1);
const fmt2 = n => Number(n).toFixed(2);

function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: IST_TIMEZONE }));
}

function hhmmssIST(date = nowIST()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function hhmmIST(date = nowIST()) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateIST(date = nowIST()) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${pad2(date.getDate())} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function shiftFromHour(h) {
  if (h >= 6 && h < 14) return 'A';
  if (h >= 14 && h < 22) return 'B';
  return 'C';
}

function ageSeconds(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - ts) / 1000);
}

function ageLabel(ts) {
  const s = ageSeconds(ts);
  if (s === null) return 'never';
  if (s < 2) return 'just now';
  if (s < 60) return `${s} sec ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} sec ago`;
  return `${Math.floor(m / 60)} h ago`;
}

/* ─────────────── IST LIVE CLOCK ─────────────── */
function tickClock() {
  const d = nowIST();
  const t = $('#liveClock');
  const dt = $('#liveDate');
  const role = $('#operatorRole');
  if (t) t.textContent = hhmmssIST(d);
  if (dt) dt.textContent = dateIST(d);
  if (role && !role.dataset.locked) {
    role.textContent = `Operator · Shift ${shiftFromHour(d.getHours())}`;
  }
  /* refresh all "X sec ago" labels every second */
  refreshAllAges();
}

function refreshAllAges() {
  const map = [
    ['#sensorUpdatedAt', MG.lastSensorUpdateAt, 'Updated'],
    ['#roverLastUpdate', MG.rover.lastUpdate || MG.lastPollAt, 'Last Update']
  ];
  map.forEach(([sel, ts, prefix]) => {
    const n = $(sel);
    if (n && ts) n.textContent = `${prefix} ${ageLabel(ts)}`;
  });
}

/* ─────────────── REST CLIENT ─────────────── */
async function api(path, opts = {}) {
  const url = API_BASE + path;
  const cfg = {
    headers: { 'Accept': 'application/json' },
    ...opts
  };
  try {
    const r = await fetch(url, cfg);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    console.warn(`[api] ${path} failed:`, e.message);
    return null;
  }
}

async function pollAll() {
  const [status, sensors, ai, workers, rover, comms, alerts, areas, vehicles] = await Promise.all([
    api('/api/status'),
    api('/api/sensors'),
    api('/api/ai-risk'),
    api('/api/workers'),
    api('/api/rover'),
    api('/api/communication'),
    api('/api/alerts'),
    api('/api/areas'),
    api('/api/vehicles')
  ]);

  const now = Date.now();

  if (sensors) {
    MG.sensors = sensors.values || sensors;
    MG.sensorMeta = sensors.meta || {};
    MG.lastSensorUpdateAt = now;
  }
  if (ai)      MG.ai       = { ...MG.ai, ...ai };
  if (workers) MG.workers  = workers.workers || workers;
  if (rover)   MG.rover    = { ...MG.rover, ...rover, lastUpdate: now };
  if (comms)   MG.comms    = { ...MG.comms, ...comms };
  if (alerts)  MG.alerts   = alerts.alerts || alerts;
  if (areas)   MG.areas    = areas.areas || areas;
  if (vehicles)MG.vehicles = vehicles.vehicles || vehicles;

  if (status) {
    if (typeof status.emergency === 'boolean' && status.emergency !== MG.emergency) {
      applyEmergencyState(status.emergency, status.emergencyId);
    }
  }

  MG.lastPollAt = now;

  renderDashboard();
  renderAlertBar();
  renderAlertsFeed();
  renderTimeline();
  renderWorkersPage();
  renderSensorHealthPage();
  renderVehiclesPage();
  renderRoverPage();
  renderWeatherPage();
  if (typeof updateMap3D === 'function') updateMap3D(MG);
}

function scheduleNextPoll() {
  if (MG.pollingHandle) clearTimeout(MG.pollingHandle);
  const delay = MG.emergency ? POLL_EMERGENCY_MS : POLL_NORMAL_MS;
  MG.pollingHandle = setTimeout(async () => {
    await pollAll();
    scheduleNextPoll();
  }, delay);
}
/* ═══════════════════════════════════════════════════════════════════
   Part 2/7 · Router, navigation, toast notifications
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── PAGE ROUTER ─────────────── */
function navigateTo(page) {
  if (!page) return;
  MG.currentPage = page;

  /* nav active state */
  $$('.nav-item').forEach(n => {
    n.classList.toggle('is-active', n.dataset.page === page);
  });

  /* page visibility */
  $$('.page').forEach(p => {
    p.classList.toggle('is-active', p.dataset.page === page);
  });

  /* re-init 3D map when map page opens */
  if (page === 'map' && typeof initFullMap3D === 'function') {
    setTimeout(() => initFullMap3D(), 60);
  }

  /* scroll top */
  const pc = $('#pageContainer');
  if (pc) pc.scrollTop = 0;
}

/* ─────────────── TOAST SYSTEM ─────────────── */
function showToast(severity, title, body = '') {
  const layer = $('#toastLayer');
  if (!layer) return;

  const severityClass =
    severity === 'crit' ? 'toast--crit' :
    severity === 'warn' ? 'toast--warn' : '';

  const node = el('div', { class: `toast ${severityClass}` }, [
    el('div', { class: 'toast__title', text: title }),
    body ? el('div', { class: 'toast__body', text: body }) : null
  ]);

  layer.appendChild(node);

  /* auto-dismiss */
  const ttl = severity === 'crit' ? 9000 : severity === 'warn' ? 6000 : 4000;
  setTimeout(() => {
    node.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    node.style.opacity = '0';
    node.style.transform = 'translateX(120%)';
    setTimeout(() => node.remove(), 420);
  }, ttl);
}

/* ─────────────── KEYBOARD SHORTCUTS ─────────────── */
function bindShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, textarea, select')) return;
    const map = {
      '1': 'dashboard', '2': 'map', '3': 'ai', '4': 'workers', '5': 'sensors',
      '6': 'rover', '7': 'emergency', '8': 'weather', '9': 'vehicles', '0': 'settings'
    };
    if (map[e.key]) navigateTo(map[e.key]);
    if (e.key === 'e' || e.key === 'E') toggleEmergency();
    if (e.key === 'r' || e.key === 'R') startRover();
    if (e.key === 'Escape') {
      closeFormIVA();
      closeInspector();
    }
  });
}

/* ─────────────── HEADER OPERATOR BINDING ─────────────── */
function bindHeader() {
  const btnIVA = $('#btnFormIVA');
  if (btnIVA) btnIVA.addEventListener('click', openFormIVA);

  const btnToggle = $('#btnToggleEmergency');
  if (btnToggle) btnToggle.addEventListener('click', toggleEmergency);
}
/* ═══════════════════════════════════════════════════════════════════
   Part 3/7 · Dashboard renderer, sensor tiles, AI/XAI panel
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── MASTER DASHBOARD RENDER ─────────────── */
function renderDashboard() {
  renderKpis();
  renderSensorTiles();
  renderAiPanel();
  renderRoverPanel();
}

/* ─────────────── KPI CARDS ─────────────── */
function renderKpis() {
  const ai = MG.ai || {};
  const score = clamp(Math.round(ai.score ?? 14), 0, 100);
  const level = score >= 90 ? 'crit' : score >= 70 ? 'high' : score >= 40 ? 'med' : 'low';
  const levelLabel = { low: 'LOW', med: 'MEDIUM', high: 'HIGH', crit: 'CRITICAL' }[level];

  const riskCard = $('#kpiRisk');
  if (riskCard) riskCard.dataset.level = level;
  setText('#kpiRiskScore', score);
  setText('#kpiRiskTag', levelLabel);
  const bar = $('#kpiRiskBar');
  if (bar) {
    bar.style.width = score + '%';
    bar.style.background = level === 'low'
      ? 'linear-gradient(90deg,#16a34a,#22c55e)'
      : level === 'med'
        ? 'linear-gradient(90deg,#d97706,#f59e0b)'
        : 'linear-gradient(90deg,#dc2626,#ef4444)';
  }

  /* Active alerts */
  const activeAlerts = MG.alerts.filter(a => a && !a.acknowledged).length;
  setText('#kpiActiveAlerts', activeAlerts);
  setText('#kpiActiveAlertsSub', activeAlerts > 0 ? 'High-risk zones detected' : 'No active alerts');

  /* Workers */
  const workers = MG.workers || [];
  const total = workers.length;
  const safe = workers.filter(w => (w.status || '').toLowerCase() === 'safe').length;
  const atRisk = workers.filter(w => (w.status || '').toLowerCase().includes('risk') || (w.status || '').toLowerCase() === 'trapped').length;
  setText('#kpiWorkers', total);
  setText('#kpiWorkersSafe', safe);
  setText('#kpiWorkersAtRisk', atRisk);

  /* Rover */
  setText('#kpiRovers', MG.rover ? 1 : 0);
  setText('#kpiRoversSub', MG.rover?.status === 'INSPECTING' ? 'Rover Inspecting' : 'Rover Online');

  /* Communication */
  const cs = MG.comms?.state || 'UNKNOWN';
  setText('#kpiComm', cs.charAt(0) + cs.slice(1).toLowerCase());
  setText('#kpiCommSignal', (MG.comms?.signal ?? 0) + '%');
}

function setText(sel, val) {
  const n = $(sel);
  if (n) n.textContent = val;
}

/* ─────────────── 12 SENSOR TILES ─────────────── */
const SENSOR_DEFS = [
  { key: 'ch4',     label: 'CH₄ · Methane',         unit: '%',      limitText: 'limit 1.25 %',   loc: 'Anchor A3 · Node N3-2 · Zone 3' },
  { key: 'co',      label: 'CO · Carbon Monoxide',  unit: 'ppm',    limitText: 'TLV 50 ppm',     loc: 'Anchor A4 · Node N4-3 · Zone 4' },
  { key: 'o2',      label: 'O₂ · Oxygen Purity',    unit: '%',      limitText: 'min 19.0 %',     loc: 'Anchor A1 · Node N1-3 · Zone 1' },
  { key: 'temp',    label: 'Strata Temperature',    unit: '°C',     limitText: 'ceiling 30.5 °C',loc: 'Anchor A3 · Node N3-3 · Zone 3' },
  { key: 'hum',     label: 'Relative Humidity',     unit: '%',      limitText: 'threshold <90 %',loc: 'Anchor A3 · Node N3-3 · Zone 3' },
  { key: 'vib',     label: 'Strata Vibration',      unit: 'mm/s',   limitText: 'collapse >0.78 g',loc:'Anchor A2 · Node N2-2 · Zone 2' },
  { key: 'water',   label: 'Sump Water Level',      unit: '%',      limitText: 'alarm 75 %',     loc: 'Anchor A2 · Node N2-3 · Zone 2' },
  { key: 'flame',   label: 'Optical Flame (IR/UV)', unit: 'ratio',  limitText: 'trip >0.50',     loc: 'Anchor A3 · Node N3-2 · Zone 3' },
  { key: 'pm10',    label: 'Respirable Dust PM₁₀',  unit: 'mg/m³',  limitText: 'ceiling <2.0',   loc: 'Anchor A4 · Node N4-3 · Zone 4' },
  { key: 'aqi',     label: 'Air Quality Index',     unit: 'AQI',    limitText: 'PM2.5 0.42 · CO₂ 0.18 %', loc: 'Anchor A4 · Node N4-3 · Zone 4' },
  { key: 'airflow', label: 'Shaft B Return Flow',   unit: 'm/s',    limitText: 'min 1.5 m/s',    loc: 'Shaft B · Upcast Stack' },
  { key: 'pir',     label: 'PIR Motion Mesh',       unit: '',       limitText: 'cross-checking UWB', loc: 'Anchor A4 · Node N4-2 · Zone 4' }
];

function renderSensorTiles() {
  SENSOR_DEFS.forEach(def => {
    const value = MG.sensors[def.key];
    const meta = MG.sensorMeta[def.key] || {};
    const lastContact = meta.lastContact || MG.lastSensorUpdateAt;

    const tile = $(`.sensor-tile[data-sensor="${def.key}"]`);
    if (!tile) return;

    /* Determine status */
    let status = 'ok';
    let labelText = 'NORMAL';
    const valEl = $('#val-' + def.key);

    if (value === null || value === undefined || meta.stale) {
      status = 'unknown';
      labelText = 'UNKNOWN';
      if (valEl) valEl.textContent = 'UNKNOWN';
      tile.dataset.status = 'unknown';
    } else {
      const st = evaluateSensorStatus(def.key, value);
      status = st.status;
      labelText = st.label;
      if (valEl) valEl.textContent = typeof value === 'number' ? (value < 1 ? fmt2(value) : fmt1(value)) : value;
      tile.dataset.status = status;
    }

    /* Badge */
    const badge = tile.querySelector('.sensor-tile__badge');
    if (badge) {
      badge.className = 'sensor-tile__badge sensor-tile__badge--' + (status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : status === 'crit' ? 'crit' : 'unknown');
      badge.textContent = labelText;
    }

    /* Location line */
    const locEl = $('#loc-' + def.key);
    if (locEl) {
      if (status === 'unknown') {
        locEl.textContent = `LAST KNOWN: ${def.loc} · ${ageLabel(lastContact)}`;
        locEl.style.color = 'var(--orange)';
      } else {
        locEl.textContent = def.loc;
        locEl.style.color = '';
      }
    }
  });
}

function evaluateSensorStatus(key, v) {
  const rules = {
    ch4:     { crit: 1.25, warn: 0.8,  invert: false, label: 'METHANE' },
    co:      { crit: 50,   warn: 25,   invert: false, label: 'CO' },
    o2:      { crit: 19.0, warn: 19.5, invert: true,  label: 'OXYGEN' },
    temp:    { crit: 30.5, warn: 28.0, invert: false, label: 'TEMP' },
    hum:     { crit: 92,   warn: 85,   invert: false, label: 'HUMIDITY' },
    vib:     { crit: 0.78, warn: 0.30, invert: false, label: 'VIBRATION' },
    water:   { crit: 75,   warn: 50,   invert: false, label: 'WATER' },
    flame:   { crit: 0.5,  warn: 0.3,  invert: false, label: 'FLAME' },
    pm10:    { crit: 2.0,  warn: 1.5,  invert: false, label: 'PM10' },
    aqi:     { crit: 150,  warn: 90,   invert: false, label: 'AQI' },
    airflow: { crit: 1.5,  warn: 1.7,  invert: true,  label: 'AIRFLOW' },
    pir:     { crit: Infinity, warn: Infinity, invert: false, label: 'PIR' }
  };
  const r = rules[key];
  if (!r) return { status: 'ok', label: 'NORMAL' };

  if (r.invert) {
    if (v < r.crit) return { status: 'crit', label: 'CRITICAL' };
    if (v < r.warn) return { status: 'warn', label: 'WARNING' };
    return { status: 'ok', label: 'NORMAL' };
  }
  if (v >= r.crit) return { status: 'crit', label: 'CRITICAL' };
  if (v >= r.warn) return { status: 'warn', label: 'HIGH' };
  return { status: 'ok', label: 'NORMAL' };
}

/* ─────────────── AI / XAI PANEL ─────────────── */
function renderAiPanel() {
  const ai = MG.ai || {};
  const score = clamp(Math.round(ai.score ?? 14), 0, 100);
  const level = score >= 90 ? 'CRITICAL' : score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';

  const pill = $('#aiRiskPill');
  if (pill) {
    pill.textContent = level;
    pill.className = 'ai-risk-pill ai-risk-pill--' + level.toLowerCase();
  }
  const pillFull = $('#aiRiskPillFull');
  if (pillFull) pillFull.textContent = `${level} — ${score} / 100`;

  const gv = $('#riskGaugeValue'); if (gv) gv.textContent = score;
  const gb = $('#riskGaugeBand'); if (gb) gb.textContent = level;

  const fill = $('#aiAssessmentFill');
  if (fill) fill.style.width = score + '%';
  setText('#aiAssessmentText', `${score} % risk of hazardous conditions`);

  /* hero */
  setText('#aiHeroTitle', score >= 70 ? 'High Risk Detected — Tunnel B (Zone 3)' : 'Monitoring — No Immediate Hazard');
  setText('#aiHeroSub', `Composite Risk Index ${score} · deterministic weighted-sum model`);

  /* attribution bars */
  setText('#aiPctGas',    (ai.gas    ?? 20) + ' %');
  setText('#aiPctVent',   (ai.vent   ?? 20) + ' %');
  setText('#aiPctStrata', (ai.strata ?? 20) + ' %');
  setText('#aiPctProx',   (ai.prox   ?? 20) + ' %');

  const bars = $$('#aiAttribution .ai-bar-fill');
  if (bars[0]) bars[0].style.width = (ai.gas ?? 20) + '%';
  if (bars[1]) bars[1].style.width = (ai.vent ?? 20) + '%';
  if (bars[2]) bars[2].style.width = (ai.strata ?? 20) + '%';
  if (bars[3]) bars[3].style.width = (ai.prox ?? 20) + '%';

  /* recommendation */
  const rec = $('#aiRecommendationBody');
  if (rec && ai.recommendation) rec.innerHTML = ai.recommendation;
}

/* ─────────────── ROVER PANEL (dashboard sidebar) ─────────────── */
function renderRoverPanel() {
  const r = MG.rover || {};
  setText('#roverOnlineText', r.status === 'INSPECTING' ? 'INSPECTING' : 'ONLINE');
  setText('#roverLocation', r.location || 'Surface Station');
  setText('#roverBatteryText', (r.battery ?? 100) + ' %');
  setText('#roverSignalText', (MG.comms?.signal ?? 91) + ' %');
  setText('#roverTemp', (r.thermal ?? 34) + ' °C');
  setText('#roverSpeed', r.status === 'INSPECTING' ? '0.4 m/s' : '0.0 m/s');

  const bBar = $('#roverBatteryBar'); if (bBar) bBar.style.width = (r.battery ?? 100) + '%';
  const sBar = $('#roverSignalBar');  if (sBar) sBar.style.width = (MG.comms?.signal ?? 91) + '%';

  setText('#roverGas', r.ch4 < 0.8 ? 'Normal' : 'Elevated');
  setText('#roverCam', 'Live');
  setText('#roverThermal', 'Live');

  /* Rover page */
  setText('#roverPageStatus', r.status || 'STANDBY');
  setText('#roverPageLocation', r.location || 'Surface Station');
  setText('#roverPageBattery', (r.battery ?? 100) + ' %');
  setText('#roverPageComm', MG.comms?.state || 'CONNECTED');
  setText('#roverPageCH4', fmt2(r.ch4 ?? 0.22) + ' %');
  setText('#roverPageThermal', fmt1(r.thermal ?? 34) + ' °C');
  setText('#roverPageHum', (r.humidity ?? 72) + ' %');
  setText('#roverPageObstacle', r.obstacle || 'CLEAR');

  const badge = $('#roverStatusBadge');
  if (badge) {
    badge.textContent = r.status || 'STANDBY';
    badge.className = 'badge ' + (r.status === 'INSPECTING' ? 'badge--crit' : 'badge--ok');
  }
}
/* ═══════════════════════════════════════════════════════════════════
   Part 4/7 · Global alert bar, full-info alerts feed, timeline
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── GLOBAL ALERT BAR ─────────────── */
function renderAlertBar() {
  const bar = $('#globalAlertBar');
  if (!bar) return;

  const active = MG.alerts.filter(a => a && !a.acknowledged);
  const top = active.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];

  if (!top) {
    bar.dataset.severity = 'none';
    setText('#globalAlertIcon', '●');
    setText('#globalAlertMessage', 'All systems nominal · No active emergency alerts');
    setText('#globalAlertMeta', `${hhmmssIST()} IST · Communication ${MG.comms.state} · ${MG.workers.length} workers tracked`);
    return;
  }

  const sev = top.severity || 'warn';
  bar.dataset.severity = sev === 'critical' || sev === 'crit' ? 'crit' : sev === 'high' ? 'crit' : sev === 'warning' || sev === 'warn' ? 'warn' : 'info';

  setText('#globalAlertIcon', sev === 'critical' || sev === 'crit' ? '🔴' : sev === 'warn' || sev === 'warning' ? '🟠' : '🔵');

  const parts = [];
  parts.push(top.title || 'Alert');
  if (top.location) parts.push(top.location);
  if (top.value)    parts.push(top.value);
  if (top.worker)   parts.push(top.worker);
  if (top.action)   parts.push(top.action);
  setText('#globalAlertMessage', parts.join(' · '));

  setText('#globalAlertMeta', `${top.time || hhmmssIST()} IST · ${active.length} active`);
}

function severityRank(s) {
  const m = { crit: 4, critical: 4, high: 3, warn: 2, warning: 2, info: 1 };
  return m[(s || '').toLowerCase()] || 0;
}

function acknowledgeAlert() {
  const top = MG.alerts.filter(a => a && !a.acknowledged).sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0];
  if (!top) return;
  top.acknowledged = true;
  api(`/api/alerts/ack/${top.id || top.uid}`, { method: 'POST' }).catch(() => {});
  renderAlertBar();
  renderAlertsFeed();
}

/* ─────────────── ALERTS FEED (full-info blocks) ─────────────── */
function renderAlertsFeed() {
  const feed = $('#alertsFeed');
  const feedFull = $('#alertsFeedFull');
  if (!feed && !feedFull) return;

  const list = (MG.alerts || []).slice().sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_ALERTS);

  const build = () => list.map(a => buildAlertBlock(a));

  if (feed)     feed.innerHTML = '';     build().forEach(n => feed.appendChild(n));
  if (feedFull) feedFull.innerHTML = ''; build().forEach(n => feedFull.appendChild(n));
}

function buildAlertBlock(a) {
  const sev = normalizeSeverity(a.severity);
  const node = el('div', { class: `alert-block alert-block--${sev}` });

  const head = el('div', { class: 'alert-block__head' }, [
    el('span', { class: 'alert-block__time', text: (a.time || hhmmIST()) + ' IST' }),
    el('span', { class: 'alert-block__level', text: sev.toUpperCase() })
  ]);
  node.appendChild(head);

  node.appendChild(el('div', { class: 'alert-block__title', text: a.title || 'System Alert' }));

  const body = el('div', { class: 'alert-block__body' });
  const rows = [
    ['Event',    a.title],
    ['Value',    a.value],
    ['Cause',    a.cause],
    ['Affected', a.worker],
    ['Sensors',  a.sensors],
    ['Comms',    a.comms || (MG.comms.state + ` (${MG.comms.signal}%, ${MG.comms.latency} ms)`)],
    ['Rover',    a.rover],
    ['AI Score', a.score ? `${a.score}/100 ${a.level || ''}` : null],
    ['Action',   a.action]
  ];
  rows.forEach(([k, v]) => {
    if (!v) return;
    const row = el('div');
    row.innerHTML = `<b>${k}:</b> ${escapeHtml(String(v))}`;
    body.appendChild(row);
  });
  node.appendChild(body);

  return node;
}

function normalizeSeverity(s) {
  const x = (s || 'info').toLowerCase();
  if (x === 'crit' || x === 'critical') return 'crit';
  if (x === 'high') return 'high';
  if (x === 'warn' || x === 'warning') return 'warn';
  return 'info';
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ─────────────── TIMELINE ─────────────── */
function renderTimeline() {
  const t = $('#emergencyTimeline');
  const tf = $('#emergencyTimelineFull');
  if (!t && !tf) return;

  const list = (MG.timeline || []).slice(-MAX_TIMELINE);

  const build = () => list.map(entry => {
    const sev = normalizeSeverity(entry.severity);
    return el('div', { class: `timeline-entry timeline-entry--${sev}` }, [
      el('span', { class: 'timeline-time', text: entry.time || hhmmIST() }),
      el('span', { class: 'timeline-dot' }),
      el('span', { class: 'timeline-text', text: entry.text || '' })
    ]);
  });

  if (t)  { t.innerHTML = '';  build().forEach(n => t.appendChild(n));  t.scrollTop = t.scrollHeight; }
  if (tf) { tf.innerHTML = ''; build().forEach(n => tf.appendChild(n)); tf.scrollTop = tf.scrollHeight; }
}

function pushTimeline(text, severity = 'info') {
  MG.timeline.push({
    time: hhmmssIST(),
    text,
    severity,
    ts: Date.now()
  });
  if (MG.timeline.length > MAX_TIMELINE) MG.timeline.shift();
}

function pushAlert(alert) {
  const full = {
    id: 'AL' + Date.now() + Math.floor(Math.random() * 1000),
    time: hhmmssIST(),
    ts: Date.now(),
    severity: alert.severity || 'info',
    title: alert.title || 'Alert',
    value: alert.value || null,
    cause: alert.cause || null,
    worker: alert.worker || null,
    sensors: alert.sensors || null,
    comms: alert.comms || null,
    rover: alert.rover || null,
    score: alert.score ?? null,
    level: alert.level || null,
    location: alert.location || null,
    action: alert.action || null,
    acknowledged: false,
    ...alert
  };
  MG.alerts.unshift(full);
  if (MG.alerts.length > MAX_ALERTS) MG.alerts.pop();

  pushTimeline(full.title + (full.location ? ` — ${full.location}` : ''), full.severity);
  renderAlertBar();
  renderAlertsFeed();
  renderTimeline();
  return full;
}
/* ═══════════════════════════════════════════════════════════════════
   Part 5/7 · Voice engine (Web Speech API) + 9 emergency cascades
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── VOICE ENGINE ─────────────── */
let voiceReady = false;
let voiceQueue = [];
let voiceSpeaking = false;

function initVoice() {
  if (!('speechSynthesis' in window)) {
    voiceReady = false;
    console.warn('[voice] Web Speech API unavailable');
    return;
  }
  voiceReady = true;
  window.speechSynthesis.onvoiceschanged = () => { /* refresh voices */ };
}

function speakAlert(text, priority = 'normal') {
  if (!MG.voiceEnabled || !voiceReady) return;

  if (priority === 'critical') {
    /* Critical alerts interrupt current speech */
    window.speechSynthesis.cancel();
    voiceQueue = [];
  }
  voiceQueue.push(text);
  drainVoiceQueue();
}

function drainVoiceQueue() {
  if (voiceSpeaking || voiceQueue.length === 0) return;
  voiceSpeaking = true;
  const text = voiceQueue.shift();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-IN';
  u.rate = 0.95;
  u.pitch = 1.0;
  u.volume = 1.0;

  /* Prefer an Indian English voice if available */
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /en-IN|en_IN/i.test(v.lang)) ||
                    voices.find(v => /en-GB/i.test(v.lang)) ||
                    voices.find(v => /^en/i.test(v.lang));
  if (preferred) u.voice = preferred;

  u.onend = () => { voiceSpeaking = false; drainVoiceQueue(); };
  u.onerror = () => { voiceSpeaking = false; drainVoiceQueue(); };

  try { window.speechSynthesis.speak(u); }
  catch (e) { voiceSpeaking = false; }
}

/* ─────────────── CASCADE DISPATCHER ─────────────── */
function triggerCascade(key) {
  const handlers = {
    grid:   cascadeGridBlackout,
    ch4:    cascadeCh4Outburst,
    lhd:    cascadeLhdRunaway,
    roof:   cascadeRoofVibration,
    p2v:    cascadeP2VProximity,
    mesh:   cascadeSeverMesh,
    buzzer: cascadeCapLampBuzzer,
    rover:  cascadeScrambleRover,
    reset:  cascadeRestoreNominal
  };
  const fn = handlers[key];
  if (fn) fn();
}

/* ─────────────── 1 · GRID BLACKOUT (CMR Reg 160) ─────────────── */
function cascadeGridBlackout() {
  enterEmergency('EM-001', '33 kV Grid Blackout · Shaft B Auxiliary');

  /* Sensors */
  MG.sensors.airflow = 0.75;
  MG.sensors.ch4 = 0.55;
  MG.sensors.co = 12;
  MG.sensors.o2 = 20.2;

  pushAlert({
    severity: 'critical',
    title: '33 kV Main Grid Failure — ATS Engaged',
    location: 'Shaft B · Upcast Ventilation',
    value: 'Auxiliary fan 0.75 m/s',
    cause: 'Grid loss · Automatic Transfer Switch <1.2 s',
    worker: 'All personnel — evacuation window 40 min',
    sensors: 'Airflow 1.85 → 0.75 m/s · CH₄ rising',
    rover: 'STANDBY · Surface Station',
    score: 78,
    level: 'HIGH',
    action: 'Begin orderly evacuation. Auxiliary ventilation active (CMR Reg 160).'
  });

  speakAlert('Warning: Main 33 kilovolt electrical grid failure. Auxiliary battery ventilation engaged.', 'critical');

  MG.ai.score = 78;
  MG.ai.gas = 20; MG.ai.vent = 45; MG.ai.strata = 20; MG.ai.prox = 15;
  MG.ai.recommendation = 'Auxiliary ventilation active. Maintain strict gas watch. Commence 40-minute evacuation under CMR Reg 160.';

  renderAll();
  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('grid');
}

/* ─────────────── 2 · CH₄ OUTBURST (CMR Reg 169) ─────────────── */
function cascadeCh4Outburst() {
  enterEmergency('EM-002', 'CH₄ Outburst · Zone 3 Longwall Face');

  MG.sensors.ch4 = 1.42;
  MG.sensors.co = 32;
  MG.sensors.temp = 42.1;
  MG.sensors.vib = 4.8;
  MG.sensors.airflow = 1.62;

  pushAlert({
    severity: 'critical',
    title: 'Methane Outburst — Zone 3 Heading Power Tripped',
    location: 'Anchor A3 · Node N3-2 · Zone 3 (Longwall Face)',
    value: 'CH₄ 1.42 % (limit 1.25 %)',
    cause: 'Methane surge · heading power isolated per CMR Reg 169',
    worker: 'W3 TRAPPED · W17 within 35 m',
    sensors: 'CH₄ 1.42 % · CO 32 ppm · Temp 42.1 °C · Vibration 4.8 mm/s',
    rover: 'DISPATCHED to Zone 3',
    score: 96,
    level: 'CRITICAL',
    action: 'Heading power isolated. Dynamic A* escape path drawn to Shaft A. Restrict entry. Deploy rover for remote inspection.'
  });

  pushAlert({
    severity: 'critical',
    title: 'Worker W3 Marked TRAPPED',
    location: 'Anchor A3 · Node N3-1 · Zone 3',
    value: 'HR 108 bpm · SpO₂ 94 %',
    cause: 'Proximity to active methane outburst',
    worker: 'W3 — Sunil Tudu',
    rover: 'DISPATCHED',
    score: 96,
    level: 'CRITICAL',
    action: 'A* escape route active. Cap-lamp strobe armed.'
  });

  speakAlert('Critical alert: Dangerous methane outburst in Zone 3. Heading power isolated. Evacuate immediately.', 'critical');

  MG.ai.score = 96;
  MG.ai.gas = 42; MG.ai.vent = 24; MG.ai.strata = 18; MG.ai.prox = 16;
  MG.ai.recommendation = 'Isolate Zone 3 heading power (Reg 169). Deploy rover for thermal/gas inspection. Do not send rescuers until CH₄ < 1.0 %.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('ch4');
  renderAll();
}

/* ─────────────── 3 · LHD RUNAWAY (CMR Reg 91) ─────────────── */
function cascadeLhdRunaway() {
  enterEmergency('EM-003', 'LHD-01 Runaway · 1:10 Incline Haulage');

  MG.sensors.vib = 6.2;

  pushAlert({
    severity: 'critical',
    title: 'Heavy Vehicle Runaway — LHD-01 on 1:10 Incline',
    location: 'Anchor A2 · Node N2-1 · Zone 2 (Haulage Incline)',
    value: '32 km/h · hydraulic 0 bar',
    cause: 'Hydraulic brake line failure',
    worker: 'All transport roadway personnel — clear immediately',
    sensors: 'Vibration 6.2 mm/s',
    rover: 'STANDBY',
    score: 88,
    level: 'HIGH',
    action: 'SAHR spring-applied brake engaged (CMR Reg 91). Clear transport roadway.'
  });

  speakAlert('Warning: Heavy vehicle runaway detected on haulage incline. Workers clear transport roadway.', 'critical');

  MG.ai.score = 88;
  MG.ai.gas = 12; MG.ai.vent = 15; MG.ai.strata = 25; MG.ai.prox = 48;
  MG.ai.recommendation = 'Activate SAHR failsafe brake. Enforce 60 m clear zone. Inspect hydraulic lines.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('lhd');
  renderAll();
}

/* ─────────────── 4 · ROOF VIBRATION (CMR Reg 137) ─────────────── */
function cascadeRoofVibration() {
  enterEmergency('EM-004', 'Roof Fracture · Zone 2 Geophone #9');

  MG.sensors.vib = 0.78;

  pushAlert({
    severity: 'critical',
    title: 'Strata Collapse Warning — 0.78 g Shear Spike',
    location: 'Anchor A2 · Node N2-2 · Zone 2',
    value: '0.78 g (baseline 0.04 g)',
    cause: 'High-frequency roof fracture detected',
    worker: 'All personnel in Zone 2 — withdraw',
    sensors: 'Vibration 0.78 g · 60 m clearance enforced',
    rover: 'STANDBY',
    score: 91,
    level: 'CRITICAL',
    action: 'Withdraw all personnel within 60 m. CMR Reg 137 evacuation order active.'
  });

  speakAlert('Strata collapse warning. High frequency roof fracture detected. Withdraw all personnel.', 'critical');

  MG.ai.score = 91;
  MG.ai.gas = 12; MG.ai.vent = 12; MG.ai.strata = 62; MG.ai.prox = 14;
  MG.ai.recommendation = 'Enforce 60 m evacuation radius. Deploy rover for roof-scan inspection. Suspend haulage.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('roof');
  renderAll();
}

/* ─────────────── 5 · P2V PROXIMITY (DGMS Circular 06) ─────────────── */
function cascadeP2VProximity() {
  pushAlert({
    severity: 'critical',
    title: 'P2V Collision Avoidance — LHD Transmission Clamped',
    location: 'Anchor A2 · Node N2-1 · Zone 2',
    value: 'Worker within 6 m blind zone · LHD 0 km/h',
    cause: 'Proximity Detection System (CAS) interlock',
    worker: 'W1 — Manoj Mahato',
    sensors: 'UWB P2V distance 5.4 m',
    rover: 'STANDBY',
    score: 84,
    level: 'HIGH',
    action: 'CAS enforced hydraulic transmission clamp. DGMS Circular 06 of 2020 compliant.'
  });

  speakAlert('Proximity warning: Worker detected in vehicle blind zone. Machine propulsion clamped.', 'critical');

  MG.ai.score = Math.max(MG.ai.score, 84);
  MG.ai.prox = 58;
  MG.ai.recommendation = 'Verify worker clearance. Release CAS interlock only after 10 m separation.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('p2v');
  renderAll();
}

/* ─────────────── 6 · SEVER MESH ─────────────── */
function cascadeSeverMesh() {
  pushAlert({
    severity: 'critical',
    title: 'Communication Mesh Severed — Telemetry TIMEOUT',
    location: 'Zone 4 Trunk · Anchor A4',
    value: 'Node N4-1 OFFLINE',
    cause: 'Rockfall severed fiber trunk between A4 and A5',
    worker: 'Sensor states → UNKNOWN (fail-safe)',
    sensors: 'Nodes N4-1, N4-2, N4-3 marked UNKNOWN',
    rover: 'DISPATCHED as wireless relay',
    score: 82,
    level: 'HIGH',
    action: 'Rover dispatched to bridge wireless mesh. Sensor states shown as UNKNOWN (never SAFE).'
  });

  speakAlert('Communication mesh severed. Autonomous rover dispatched to establish relay.', 'critical');

  /* Mark affected nodes stale */
  ['pm10', 'aqi', 'co'].forEach(k => {
    MG.sensorMeta[k] = MG.sensorMeta[k] || {};
    MG.sensorMeta[k].stale = true;
    MG.sensorMeta[k].lastContact = Date.now() - 30000;
  });

  MG.comms.state = 'DEGRADED';
  MG.comms.signal = 42;

  MG.ai.score = Math.max(MG.ai.score, 82);
  MG.ai.recommendation = 'Rover relay deployment in progress. Do not treat missing sensor data as safe. Inspect physical trunk.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('mesh');
  renderAll();
}

/* ─────────────── 7 · CAP-LAMP BUZZER ─────────────── */
function cascadeCapLampBuzzer() {
  pushAlert({
    severity: 'critical',
    title: 'Cap-Lamp Strobe & 95 dB Buzzer Dispatched',
    location: 'Worker W3 Tag · Anchor A3 · Node N3-1',
    value: 'Bi-directional UWB downlink OK',
    cause: 'Manual evacuation signal triggered by control room',
    worker: 'W3 — Sunil Tudu · strobe active',
    sensors: 'Collar tag downlink confirmed',
    rover: 'DISPATCHED to Zone 3',
    score: 90,
    level: 'CRITICAL',
    action: 'Strobe + audible buzzer active on W3. Confirm visual acknowledgment via UWB telemetry.'
  });

  speakAlert('Evacuation strobe signal dispatched to underground personnel collar tags.', 'critical');

  MG.ai.score = Math.max(MG.ai.score, 90);
  MG.ai.recommendation = 'Maintain downlink contact. Confirm W3 has acknowledged. Monitor escape path progress.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('buzzer');
  renderAll();
}

/* ─────────────── 8 · SCRAMBLE ROVER ─────────────── */
function cascadeScrambleRover() {
  MG.rover.status = 'INSPECTING';
  MG.rover.location = 'Zone 3 · Longwall Heading';
  MG.rover.thermal = 46.5;
  MG.rover.ch4 = 1.18;
  MG.rover.lastUpdate = Date.now();

  pushAlert({
    severity: 'critical',
    title: 'Autonomous Rescue Rover Deployed to Zone 3',
    location: 'Zone 3 · Longwall Heading',
    value: 'FLIR stream active · forward CH₄ sniffer 1.18 %',
    cause: 'Control-room dispatch for remote reconnaissance',
    worker: 'No humans in Zone 3 (perimeter enforced)',
    sensors: 'Rover: CH₄ 1.18 % · Temp 46.5 °C',
    rover: 'INSPECTING · Zone 3',
    score: 92,
    level: 'CRITICAL',
    action: 'Rover conducting remote gas + thermal recon. Await imagery before committing rescue team.'
  });

  speakAlert('Autonomous rescue rover deployed to hazardous extraction heading.', 'critical');

  MG.ai.score = Math.max(MG.ai.score, 92);
  MG.ai.recommendation = 'Await rover imagery and gas concentration confirmation. Do not commit humans until safe.';

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('rover');
  renderAll();
}

/* ─────────────── 9 · RESTORE NOMINAL ─────────────── */
function cascadeRestoreNominal() {
  /* Sensors back to baseline */
  MG.sensors = {
    ch4: 0.22, co: 4.2, o2: 20.8, temp: 27.6, hum: 72.4,
    vib: 0.04, water: 22, flame: 0.00, pm10: 0.84, aqi: 42,
    airflow: 1.85, pir: 'MESH'
  };
  MG.sensorMeta = {};

  /* Rover home */
  MG.rover = {
    status: 'STANDBY', location: 'Surface Station', battery: 100,
    comms: 'CONNECTED', ch4: 0.22, thermal: 34.0, humidity: 72,
    obstacle: 'CLEAR', lastUpdate: Date.now()
  };

  /* Comms */
  MG.comms = { state: 'CONNECTED', signal: 91, latency: 42 };

  /* AI */
  MG.ai = {
    score: 14, level: 'LOW',
    gas: 20, vent: 20, strata: 20, prox: 20,
    recommendation: 'Continue routine monitoring. All statutory parameters within CMR 2017 limits.'
  };

  /* Clear emergency */
  exitEmergency();

  pushAlert({
    severity: 'info',
    title: 'Statutory Nominal Baseline Restored',
    location: 'Whole Mine',
    value: 'CH₄ 0.22 % · Airflow 1.85 m/s · All systems green',
    cause: 'Manual reset by control-room operator',
    score: 14,
    level: 'LOW',
    action: 'All CMR 2017 limits satisfied. Normal operations may resume.'
  });

  speakAlert('All systems restored to statutory nominal baseline.', 'critical');

  if (typeof triggerMap3DEvent === 'function') triggerMap3DEvent('reset');
  renderAll();
}

/* ─────────────── EMERGENCY STATE HELPERS ─────────────── */
function enterEmergency(id, title) {
  MG.emergency = true;
  MG.emergencyId = id;
  MG.emergencyStartTs = Date.now();
  document.body.classList.add('is-emergency');

  const bar = $('#globalAlertBar');
  if (bar) bar.dataset.severity = 'crit';

  const btn = $('#btnToggleEmergency');
  if (btn) { btn.textContent = '🛑 STOP EMERGENCY MODE'; btn.classList.add('btn-danger'); }

  setText('#emgId', id);
  setText('#emgLoc', title);
  setText('#emgStatus', 'ACTIVE');

  /* speed up polling */
  scheduleNextPoll();
}

function exitEmergency() {
  MG.emergency = false;
  MG.emergencyId = null;
  MG.emergencyStartTs = null;
  document.body.classList.remove('is-emergency');

  const btn = $('#btnToggleEmergency');
  if (btn) { btn.textContent = '⚡ EMERGENCY MODE'; btn.classList.remove('btn-danger'); }

  setText('#emgStatus', 'RESOLVED');

  scheduleNextPoll();
}

function toggleEmergency() {
  if (MG.emergency) {
    api('/api/emergency/stop', { method: 'POST' }).catch(() => {});
    cascadeRestoreNominal();
  } else {
    api('/api/emergency/start', { method: 'POST' }).catch(() => {});
    cascadeCh4Outburst();
  }
}

/* ─────────────── MASTER RENDER ─────────────── */
function renderAll() {
  renderDashboard();
  renderAlertBar();
  renderAlertsFeed();
  renderTimeline();
  renderWorkersPage();
  renderSensorHealthPage();
  renderVehiclesPage();
  renderRoverPage();
  renderWeatherPage();
  if (typeof updateMap3D === 'function') updateMap3D(MG);
}
/* ═══════════════════════════════════════════════════════════════════
   Part 6/7 · Page-specific renderers
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── WORKERS PAGE ─────────────── */
function renderWorkersPage() {
  const tbody = $('#workersTableBody');
  if (!tbody) return;

  const rows = (MG.workers || []).map(w => {
    const statusClass = statusClassForWorker(w.status);
    const hr = w.hr ?? '--';
    const spo2 = w.spo2 ?? '--';
    const dist = w.distance_from_hazard ?? w.distance ?? '--';
    const contact = w.lastContact ? ageLabel(w.lastContact) : 'LIVE';

    return `<tr>
      <td class="cell-mono">${escapeHtml(w.id || '')}</td>
      <td>${escapeHtml(w.name || '')}</td>
      <td>${escapeHtml(w.zone || '')}</td>
      <td class="cell-mono">${escapeHtml(w.anchorNode || (w.anchor ? `${w.anchor} · ${w.node || ''}` : ''))}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(w.status || 'UNKNOWN')}</span></td>
      <td class="cell-mono">${hr}${hr !== '--' ? ' bpm' : ''}</td>
      <td class="cell-mono">${spo2}${spo2 !== '--' ? ' %' : ''}</td>
      <td class="cell-mono">${dist}${dist !== '--' ? ' m' : ''}</td>
      <td class="cell-mono">${contact}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows || `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:20px;">No workers tracked</td></tr>`;
}

function statusClassForWorker(s) {
  const x = (s || '').toLowerCase();
  if (x === 'safe') return 'badge--ok';
  if (x.includes('risk') || x === 'trapped' || x === 'critical') return 'badge--crit';
  if (x === 'warning') return 'badge--warn';
  return 'badge--warn';
}

/* ─────────────── SENSOR HEALTH PAGE ─────────────── */
function renderSensorHealthPage() {
  const tbody = $('#sensorHealthBody');
  if (!tbody) return;

  const rows = SENSOR_DEFS.map(def => {
    const val = MG.sensors[def.key];
    const meta = MG.sensorMeta[def.key] || {};
    const st = (val === null || val === undefined || meta.stale) ? 'UNKNOWN' : evaluateSensorStatus(def.key, val).status;

    const badge = st === 'ok' ? 'badge--ok' : st === 'warn' ? 'badge--warn' : st === 'crit' ? 'badge--crit' : 'badge--warn';
    const displayVal = (val === null || val === undefined || meta.stale)
      ? 'UNKNOWN'
      : (typeof val === 'number' ? (val < 1 ? fmt2(val) : fmt1(val)) + ' ' + def.unit : val);

    return `<tr>
      <td class="cell-mono">${escapeHtml(def.key.toUpperCase())}</td>
      <td>${escapeHtml(def.label)}</td>
      <td class="cell-mono">${escapeHtml(def.loc)}</td>
      <td class="cell-mono">${escapeHtml(displayVal)}</td>
      <td><span class="badge ${badge}">${st === 'unknown' ? 'UNKNOWN' : st === 'crit' ? 'CRITICAL' : st === 'warn' ? 'WARNING' : 'ONLINE'}</span></td>
      <td class="cell-mono">2026-08-14</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = rows;
}

/* ─────────────── VEHICLES PAGE ─────────────── */
function renderVehiclesPage() {
  const tbody = $('#vehiclesTableBody');
  if (!tbody) return;

  const list = MG.vehicles || [];
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:20px;">No vehicles tracked</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(v => {
    const commBadge = (v.comms || v.communication || 'CONNECTED') === 'CONNECTED' ? 'badge--ok' : 'badge--warn';
    const hazard = v.nearbyHazard && v.nearbyHazard !== 'NONE'
      ? `<span class="badge badge--crit">${escapeHtml(v.nearbyHazard)}</span>`
      : `<span class="badge badge--ok">NONE</span>`;

    return `<tr>
      <td class="cell-mono">${escapeHtml(v.id || '')}</td>
      <td>${escapeHtml(v.type || '')}</td>
      <td>${escapeHtml(v.location || '')}</td>
      <td class="cell-mono">${v.speed ?? 0} km/h</td>
      <td>${escapeHtml(v.operator || '—')}</td>
      <td class="cell-mono">${v.fuel ?? v.battery ?? '—'} ${v.fuelUnit || (v.battery ? '%' : '')}</td>
      <td><span class="badge ${commBadge}">${escapeHtml(v.comms || v.communication || 'CONNECTED')}</span></td>
      <td>${hazard}</td>
    </tr>`;
  }).join('');
}

/* ─────────────── WEATHER PAGE ─────────────── */
function renderWeatherPage() {
  setText('#wWeather', MG.weather?.condition || 'Clear');
  setText('#wRainfall', (MG.weather?.rainfall ?? 12) + ' mm');
  const fr = $('#wFloodRisk');
  if (fr) {
    const risk = MG.weather?.floodRisk || 'LOW';
    fr.textContent = risk;
    fr.className = 'kpi-value ' + (risk === 'HIGH' ? 'text-red' : risk === 'MEDIUM' ? 'text-orange' : 'text-green');
  }
  setText('#wWaterLevel', (MG.sensors.water ?? 22) + ' %');
  setText('#wAffected', MG.weather?.affected || 'No tunnels currently affected. Sump level nominal.');
}

/* ─────────────── ROVER PAGE (extra bits) ─────────────── */
function renderRoverPage() {
  /* mostly handled in renderRoverPanel; page-specific extras here */
  const camN = $('#cameraNormal');
  if (camN) camN.textContent = '📷 Live — ' + (MG.rover.location || 'Surface Station');
  const camT = $('#cameraThermal');
  if (camT) camT.textContent = `🌡 Thermal · ${fmt1(MG.rover.thermal ?? 34)} °C`;
}

/* ─────────────── ROVER ACTIONS ─────────────── */
function startRover() {
  MG.rover.status = 'INSPECTING';
  MG.rover.location = 'Zone 3 · Longwall Heading';
  MG.rover.lastUpdate = Date.now();
  api('/api/rover/start', { method: 'POST' }).catch(() => {});

  pushAlert({
    severity: 'warn',
    title: 'Rescue Rover Dispatched',
    location: 'Zone 3 · Longwall Heading',
    value: 'Status: INSPECTING',
    cause: 'Manual dispatch from control room',
    rover: 'INSPECTING — ETA 2 min',
    score: MG.ai.score,
    level: MG.ai.level,
    action: 'Await rover telemetry. Do not send humans until area confirmed safe.'
  });

  speakAlert('Rescue rover dispatched to Zone 3 heading.', 'normal');
  renderAll();
}

function stopRover() {
  MG.rover.status = 'STANDBY';
  MG.rover.location = 'Surface Station';
  MG.rover.lastUpdate = Date.now();
  api('/api/rover/stop', { method: 'POST' }).catch(() => {});

  pushAlert({
    severity: 'info',
    title: 'Rover Recalled to Surface Station',
    value: 'Status: STANDBY',
    rover: 'STANDBY — Surface Station',
    action: 'Rover docked. Battery charging.'
  });

  renderAll();
}

/* ─────────────── SENSOR TILE CLICK ─────────────── */
function inspectSensor(key) {
  const def = SENSOR_DEFS.find(d => d.key === key);
  if (!def) return;
  const val = MG.sensors[key];
  const meta = MG.sensorMeta[key] || {};
  const stale = (val === null || val === undefined || meta.stale);

  openInspector(def.label, [
    ['Category', 'Statutory Transducer'],
    ['Reading', stale ? 'UNKNOWN' : (typeof val === 'number' ? (val < 1 ? fmt2(val) : fmt1(val)) + ' ' + def.unit : val)],
    ['Location', def.loc],
    ['Limit', def.limitText],
    ['Status', stale ? 'SIGNAL LOST' : evaluateSensorStatus(key, val).status.toUpperCase()],
    ['Last Contact', meta.lastContact ? `${hhmmssIST(new Date(meta.lastContact))} IST (${ageLabel(meta.lastContact)})` : 'LIVE'],
    ['Regulatory', def.key === 'ch4' ? 'CMR Reg 169' :
                   def.key === 'o2'  ? 'CMR Reg 153' :
                   def.key === 'airflow' ? 'CMR Reg 156' :
                   def.key === 'vib' ? 'CMR Reg 137' : 'DGMS Standard']
  ]);
}
/* ═══════════════════════════════════════════════════════════════════
   Part 7/7 · Entity inspector, Form IV-A modal, boot sequence
═══════════════════════════════════════════════════════════════════ */

/* ─────────────── ENTITY INSPECTOR ─────────────── */
function openInspector(title, rows) {
  const drawer = $('#entityInspector');
  if (!drawer) return;
  setText('#entityInspectorTitle', title);

  const body = $('#entityInspectorBody');
  body.innerHTML = '';
  rows.forEach(([k, v]) => {
    const row = el('div', { class: 'inspector-row' }, [
      el('span', { text: k }),
      el('b', { text: v ?? '—' })
    ]);
    body.appendChild(row);
  });
  drawer.classList.add('is-open');
}

function closeInspector() {
  const d = $('#entityInspector');
  if (d) d.classList.remove('is-open');
}

/* Public hook for map to call */
window.focusEntity = function (id) {
  const map = {
    shaftA: () => openInspector('SHAFT A · Main Intake', [
      ['Type', 'Downcast intake airway'],
      ['RL', '−480 m'],
      ['Airflow', 'Intake · positive pressure'],
      ['Location', 'Top-mid left bank'],
      ['Regulatory', 'CMR Reg 156']
    ]),
    shaftB: () => openInspector('SHAFT B · Upcast Ventilation', [
      ['Type', 'Upcast exhaust stack'],
      ['Airflow', (MG.sensors.airflow ?? 1.85) + ' m/s'],
      ['Fan', '4-blade · rotating'],
      ['Regulatory', 'CMR Reg 156 / 160']
    ]),
    zone1: () => openInspector('ZONE 1 · Intake Haulage Drift', [
      ['Anchor', 'A1'], ['Nodes', 'N1-1 · N1-2 · N1-3'],
      ['Workers', 'W1 — safe'], ['Risk', 'LOW'],
      ['Communication', MG.comms.state]
    ]),
    zone2: () => openInspector('ZONE 2 · 1:10 Incline Haulage', [
      ['Anchor', 'A2'], ['Nodes', 'N2-1 · N2-2 · N2-3'],
      ['Gradient', '1:10'], ['Sump', (MG.sensors.water ?? 22) + ' %'],
      ['Risk', MG.ai.score >= 70 ? 'HIGH' : 'MEDIUM']
    ]),
    zone3: () => openInspector('ZONE 3 · Longwall Coal Face', [
      ['Anchor', 'A3'], ['Nodes', 'N3-1 · N3-2 · N3-3'],
      ['Workers', 'W3 — TRAPPED · W17 — HIGH RISK'],
      ['CH₄', (MG.sensors.ch4 ?? 0.22) + ' %'],
      ['Risk', MG.ai.score >= 90 ? 'CRITICAL' : 'HIGH']
    ]),
    zone4: () => openInspector('ZONE 4 · Cross-Cut Airway', [
      ['Anchor', 'A4'], ['Nodes', 'N4-1 · N4-2 · N4-3'],
      ['CO', (MG.sensors.co ?? 4.2) + ' ppm'],
      ['Communication', MG.comms.state]
    ]),
    zone5: () => openInspector('ZONE 5 · Refuge Sanctuary Bay', [
      ['Anchor', 'A5'], ['Nodes', 'N5-1 · N5-2'],
      ['Workers', 'W2 — safe'], ['O₂ supply', '36 h compressed'],
      ['Regulatory', 'CMR Reg 91']
    ]),
    lhd01: () => openInspector('LHD-01 · Trackless Loader', [
      ['Status', 'ACTIVE'], ['Speed', '8 km/h'],
      ['P2V CAS', '15 m bubble · armed'],
      ['Brake', 'SAHR spring-applied'],
      ['Regulatory', 'DGMS Circular 06 / 2020']
    ]),
    roverR1: () => openInspector('ROV-01 · Rescue Rover', [
      ['Status', MG.rover.status],
      ['Location', MG.rover.location],
      ['Battery', (MG.rover.battery ?? 100) + ' %'],
      ['Thermal', fmt1(MG.rover.thermal ?? 34) + ' °C'],
      ['CH₄ sniffer', fmt2(MG.rover.ch4 ?? 0.22) + ' %']
    ]),
    sump: () => openInspector('SUMP Basin', [
      ['Type', 'HC-SR04 ultrasonic'],
      ['Fill', (MG.sensors.water ?? 22) + ' %'],
      ['Alarm', '75 %'],
      ['Location', 'Anchor A2 · Node N2-3 · Zone 2']
    ]),
    workerW1: () => openInspector('Worker W1 — Manoj Mahato', [
      ['Status', 'SAFE'], ['Location', 'Anchor A1 · Node N1-1 · Zone 1'],
      ['HR', '78 bpm'], ['SpO₂', '98 %']
    ]),
    workerW2: () => openInspector('Worker W2 — Rajesh Kumar', [
      ['Status', 'SAFE · Refuge Bay'], ['Location', 'Anchor A5 · Node N5-1 · Zone 5'],
      ['HR', '82 bpm'], ['SpO₂', '97 %']
    ]),
    workerW3: () => openInspector('Worker W3 — Sunil Tudu', [
      ['Status', 'TRAPPED'], ['Location', 'Anchor A3 · Node N3-1 · Zone 3'],
      ['HR', '108 bpm'], ['SpO₂', '94 %'],
      ['Action', 'A* escape route to Shaft A active']
    ]),
    bordPillar: () => openInspector('Bord & Pillar layout', [
      ['Type', 'Secondary extraction grid'],
      ['Location', 'Zone 1 vicinity']
    ])
  };
  const fn = map[id];
  if (fn) fn();
  else openInspector('Entity ' + id, [['Info', 'No detailed metadata available']]);
};

/* ─────────────── FORM IV-A MODAL ─────────────── */
function openFormIVA() {
  const m = $('#formIVAModal');
  if (!m) return;

  const now = nowIST();
  setText('#formEmgTime', `${dateIST(now)} · ${hhmmssIST(now)} IST`);
  setText('#formEmgId', MG.emergencyId || 'EM-000');
  setText('#formEmgLoc', MG.emergency ? 'Tunnel B (Zone 3)' : 'Whole Mine');

  /* Sensor breach list — dynamic */
  const list = $('#formSensorList');
  if (list) {
    list.innerHTML = `
      <li>CH₄ peak ${fmt2(MG.sensors.ch4 ?? 0.22)} % (limit 1.25 % · CMR 2017 Reg 169)</li>
      <li>Temperature peak ${fmt1(MG.sensors.temp ?? 27.6)} °C (limit 30.5 °C · Reg 156)</li>
      <li>Vibration peak ${fmt2(MG.sensors.vib ?? 0.04)} g (evacuation 0.78 g · Reg 137)</li>
      <li>Shaft B airflow minimum ${fmt2(MG.sensors.airflow ?? 1.85)} m/s (statutory 1.85 m/s · Reg 160)</li>
    `;
  }

  m.style.display = 'grid';
}

function closeFormIVA() {
  const m = $('#formIVAModal');
  if (m) m.style.display = 'none';
}

function printFormIVA() {
  window.print();
}

/* ─────────────── CASCADE PANEL TOGGLE ─────────────── */
function toggleCascadePanel() {
  const p = $('#cascadePanel');
  if (!p) return;
  p.classList.toggle('is-collapsed');
  const btn = p.querySelector('.cascade-panel__header button');
  if (btn) btn.textContent = p.classList.contains('is-collapsed') ? '+' : '–';
}

/* ─────────────── MAP LEGEND TOGGLE (map page) ─────────────── */
function toggleMapLegend() {
  const l = $('#mapLegendFull');
  if (l) l.style.display = (l.style.display === 'none') ? 'block' : 'none';
}

function resetMapCamera() {
  if (typeof resetFullMapCamera === 'function') resetFullMapCamera();
}

/* ─────────────── BOOT SEQUENCE ─────────────── */
async function boot() {
  if (MG.booted) return;
  MG.booted = true;
  console.log('[MineGuard AI] Booting…');

  /* Voice */
  initVoice();

  /* Header bindings */
  bindHeader();
  bindShortcuts();

  /* Clock */
  tickClock();
  MG.clockHandle = setInterval(tickClock, 1000);

  /* Initial poll */
  await pollAll();

  /* Start periodic polling */
  scheduleNextPoll();

  /* Initial render */
  renderAll();

  /* Welcome toast */
  showToast('info', 'MineGuard AI online', 'Connected to Jharia Seam XI SCADA · IST clock active');

  /* Try to init 3D map */
  if (typeof initMap3D === 'function') {
    try { initMap3D(); } catch (e) { console.warn('[map3d]', e); }
  }

  console.log('[MineGuard AI] Ready.');
}

/* ─────────────── AUTO BOOT ─────────────── */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

/* ─────────────── EXPORTS (for tunnel_3d.js interop) ─────────────── */
window.MineGuardState = MG;
window.navigateTo      = navigateTo;
window.triggerCascade  = triggerCascade;
window.toggleEmergency = toggleEmergency;
window.startRover      = startRover;
window.stopRover       = stopRover;
window.inspectSensor   = inspectSensor;
window.openFormIVA     = openFormIVA;
window.closeFormIVA    = closeFormIVA;
window.printFormIVA    = printFormIVA;
window.acknowledgeAlert= acknowledgeAlert;
window.closeInspector  = closeInspector;
window.toggleCascadePanel = toggleCascadePanel;
window.toggleMapLegend = toggleMapLegend;
window.resetMapCamera  = resetMapCamera;



/* ─── Missing function fix ─── */
function applyEmergencyState(isActive, id) {
  if (isActive) {
    enterEmergency(id || 'EM-000', 'Emergency Active');
  } else {
    exitEmergency();
  }
}
window.applyEmergencyState = applyEmergencyState;
