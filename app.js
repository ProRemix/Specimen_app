// ============================================================
// APPLI ROBOT - modes Aléatoire / Mimétisme / Animations + STOP + QR
// ============================================================
import { CONFIG, loadSettings, saveSettings } from './config.js';
import { MODE, MODE_LABEL, EXPR, EXPR_LABEL, ANIMS, ANIM_NONE } from './protocol.js';
import { RobotLink } from './ble.js';
import { FaceTracker } from './tracker.js';
import { OneEuro } from './filters.js';
import { ExpressionDetector } from './expressions.js';
import { initQr } from './qr.js';

const $ = (id) => document.getElementById(id);

const PUMP_LABEL = {
  0: 'Repos', 1: 'Alerte', 2: 'Curiosité', 3: 'Défense', 4: 'Vibration', 5: 'Goutte-à-goutte', 6: 'Saccades',
  10: 'Calme', 11: 'Emballement', 12: 'Retour au calme',
};
const HEAD_LABEL = { 0: 'Éveillé', 1: 'Endormissement', 2: 'Endormissement', 3: 'Sommeil', 4: 'Réveil' };
// Durées des animations (ms), identiques au firmware : pour la barre de progression
const ANIM_DURATION = [1600, 1800, 2200, 3200, 2600, 2000, 3600, 2000];

const link = new RobotLink();
const tracker = new FaceTracker($('vid'), $('mesh'));
const detector = new ExpressionDetector();
let settings = loadSettings();

// État du joystick (valeurs envoyées au robot)
const joy = { pitch: 0, roll: 0, yaw: 0, pumpA: 0, pumpB: 0, hold: false };

const app = {
  desiredMode: null,      // mode choisi sur le téléphone (null = rien demandé)
  robotMode: null,        // mode confirmé par le robot
  status: null,
  calib: null,
  shouldCalibrate: false,
  last: null,
  lastFaceT: 0,
  playingAnim: ANIM_NONE,
};

const filters = {
  pitch: new OneEuro(CONFIG.oneEuro),
  roll: new OneEuro(CONFIG.oneEuro),
  yaw: new OneEuro(CONFIG.oneEuro),
};
const resetFilters = () => Object.values(filters).forEach((f) => f.reset());

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rel = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;
const NEUTRAL_PACKET = { face: false, pitch: 0, roll: 0, yaw: 0, expression: EXPR.NEUTRAL, intensity: 0 };

// ------------------------------------------------------------
// Mimétisme : mesure -> valeurs robot
// ------------------------------------------------------------
tracker.onFrame = (f) => {
  if (!f.face) {
    $('face-state').textContent = 'Aucun visage';
    return;
  }
  app.lastFaceT = f.t;
  $('face-state').textContent = 'Visage';

  if (app.shouldCalibrate || !app.calib) {
    app.calib = { pitch: f.pitch, roll: f.roll, yaw: f.yaw };
    detector.calibrate(f.bs);
    app.shouldCalibrate = false;
    resetFilters();
  }

  const s = settings;
  const sign = (inv) => (inv ? -1 : 1);
  const pitch = clamp(rel(f.pitch, app.calib.pitch) * s.gainPitch * sign(s.invertPitch), -CONFIG.limits.pitch, CONFIG.limits.pitch);
  const roll = clamp(rel(f.roll, app.calib.roll) * s.gainRoll * sign(s.invertRoll), -CONFIG.limits.roll, CONFIG.limits.roll);
  const yaw = clamp(rel(f.yaw, app.calib.yaw) * s.gainYaw * sign(s.invertYaw), -CONFIG.limits.yaw, CONFIG.limits.yaw);
  const ex = detector.update(f.bs, f.t);

  app.last = {
    face: true,
    pitch: filters.pitch.filter(pitch, f.t),
    roll: filters.roll.filter(roll, f.t),
    yaw: filters.yaw.filter(yaw, f.t),
    expression: s.pumpsEnabled ? ex.expression : EXPR.NEUTRAL,
    intensity: s.pumpsEnabled ? ex.intensity : 0,
  };

  $('val-pitch').textContent = app.last.pitch.toFixed(0);
  $('val-roll').textContent = app.last.roll.toFixed(0);
  $('val-yaw').textContent = app.last.yaw.toFixed(0);
  $('expr-label').textContent = EXPR_LABEL[ex.expression];
  $('expr-bar').style.width = `${Math.round(ex.intensity * 100)}%`;
  $('expr-bar').dataset.expr = ex.expression;
};

// Envoi 50 Hz en mimétisme
setInterval(() => {
  if (app.desiredMode !== MODE.MIMIC || !link.connected) return;
  const fresh = app.last && performance.now() / 1000 - app.lastFaceT < CONFIG.FACE_LOST_MS / 1000;
  link.sendMimic(fresh ? app.last : NEUTRAL_PACKET);
}, CONFIG.SEND_PERIOD_MS);

// Envoi 50 Hz en mode joystick
setInterval(() => {
  if (app.desiredMode !== MODE.MANUAL || !link.connected) return;
  link.sendManual(joy);
}, CONFIG.SEND_PERIOD_MS);

// Le mode choisi est renvoyé chaque seconde (robot redémarré, message perdu, reconnexion)
setInterval(() => {
  if (app.desiredMode !== null && link.connected) link.sendMode(app.desiredMode);
  $('fps').textContent = tracker.running ? `${tracker.fps} fps` : '—';
}, CONFIG.MODE_RESEND_MS);

// ------------------------------------------------------------
// Modes
// ------------------------------------------------------------
async function setMode(mode) {
  const changed = app.desiredMode !== mode;
  app.desiredMode = mode;
  link.sendMode(mode, mode === MODE.STOP ? CONFIG.STOP_REPEAT : 2);
  render();

  if (mode === MODE.MIMIC) {
    if (!changed && tracker.running) return;
    try {
      $('face-state').textContent = 'Chargement…';
      await tracker.start();
      app.calib = null;   // recentrage automatique sur la première image
    } catch (err) {
      $('face-state').textContent = 'Caméra indisponible';
      console.error(err);
    }
  } else {
    tracker.stop();
    $('face-state').textContent = 'Caméra éteinte';
    app.last = null;
  }
}

function playAnim(id) {
  if (app.desiredMode !== MODE.ANIM) setMode(MODE.ANIM);
  link.sendAnim(id);
  showPlaying(id);
  if (navigator.vibrate) navigator.vibrate(15);
}

let playingTimer = null;
function showPlaying(id) {
  document.querySelectorAll('.anim').forEach((el) => {
    const on = Number(el.dataset.anim) === id;
    el.classList.remove('playing');
    if (on) {
      void el.offsetWidth;                       // relance la barre de progression
      el.style.setProperty('--dur', `${ANIM_DURATION[id]}ms`);
      el.classList.add('playing');
    }
  });
  clearTimeout(playingTimer);
  playingTimer = setTimeout(() => {
    document.querySelectorAll('.anim.playing').forEach((el) => el.classList.remove('playing'));
  }, ANIM_DURATION[id] ?? 2000);
}

function render() {
  const shown = app.desiredMode ?? app.robotMode;
  document.querySelectorAll('.tab').forEach((t) => {
    const m = Number(t.dataset.mode);
    t.classList.toggle('selected', app.desiredMode === m);
    t.classList.toggle('confirmed', app.robotMode === m);
  });
  $('panel-idle').hidden = !(shown === null || shown === MODE.STOP);
  $('panel-random').hidden = shown !== MODE.RANDOM;
  $('panel-mimic').hidden = shown !== MODE.MIMIC;
  $('panel-anim').hidden = shown !== MODE.ANIM;
  $('panel-joy').hidden = shown !== MODE.MANUAL;

  // Ligne d'état
  const parts = ['Robot'];
  if (!link.connected) parts.push('non connecté');
  else {
    parts.push(app.robotMode === null ? '…' : MODE_LABEL[app.robotMode]);
    if (app.status) parts.push(`${app.status.rxPerSec} msg/s`);
  }
  $('status-line').textContent = parts.join(' · ');

  // Fiche du mode aléatoire
  const st = app.status;
  $('spec-head').textContent = st && app.robotMode === MODE.RANDOM ? HEAD_LABEL[st.macroState] ?? '—' : '—';
  $('spec-pumps').textContent = st && app.robotMode === MODE.RANDOM ? PUMP_LABEL[st.pumpMood] ?? '—' : '—';
  $('spec-link').textContent = link.connected ? 'Bluetooth' : 'Autonome';
}

document.querySelectorAll('.tab').forEach((t) => {
  t.addEventListener('click', () => setMode(Number(t.dataset.mode)));
});

$('btn-stop').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(60);
  $('joy-center').click();                 // remet aussi le joystick et ses pompes à zéro
  setMode(MODE.STOP);
});

$('btn-calibrate').addEventListener('click', () => {
  app.shouldCalibrate = true;
  const btn = $('btn-calibrate');
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 800);
});

$('btn-mesh').addEventListener('click', () => {
  const vid = $('vid');
  const meshOnly = vid.style.opacity !== '0';
  vid.style.opacity = meshOnly ? '0' : '1';
  $('btn-mesh').classList.toggle('active', meshOnly);
  $('btn-mesh').textContent = meshOnly ? 'Vidéo' : 'Mesh seul';
});

// Grille d'animations
$('anim-grid').innerHTML = ANIMS.map((a) => `
  <button class="anim" data-anim="${a.id}">
    <span class="num">A-${String(a.id + 1).padStart(2, '0')}</span>
    <span class="anim-name">${a.name}</span>
    <span class="anim-hint">${a.hint}</span>
  </button>`).join('');
$('anim-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.anim');
  if (b) playAnim(Number(b.dataset.anim));
});

// ------------------------------------------------------------
// Joystick
// ------------------------------------------------------------
function initJoystick() {
  const pad = $('joy');
  const knob = $('joy-knob');
  let active = null;

  const setStick = (nx, ny) => {            // nx, ny entre -1 et 1 (y vers le haut)
    const r = pad.clientWidth / 2 - 36;
    knob.style.transform = `translate(${nx * r}px, ${-ny * r}px)`;
    joy.yaw = nx * CONFIG.limits.yaw * (CONFIG.joystick.invertX ? -1 : 1);
    joy.pitch = ny * CONFIG.limits.pitch * (CONFIG.joystick.invertY ? -1 : 1);
    $('joy-yaw').textContent = joy.yaw.toFixed(0);
    $('joy-pitch').textContent = joy.pitch.toFixed(0);
  };

  const fromEvent = (e) => {
    const rect = pad.getBoundingClientRect();
    let nx = (e.clientX - rect.left) / rect.width * 2 - 1;
    let ny = 1 - (e.clientY - rect.top) / rect.height * 2;
    const len = Math.hypot(nx, ny);
    if (len > 1) { nx /= len; ny /= len; }
    setStick(nx, ny);
  };

  pad.addEventListener('pointerdown', (e) => {
    if (app.desiredMode !== MODE.MANUAL) setMode(MODE.MANUAL);
    active = e.pointerId;
    pad.setPointerCapture(e.pointerId);
    pad.classList.add('dragging');
    fromEvent(e);
  });
  pad.addEventListener('pointermove', (e) => { if (e.pointerId === active) fromEvent(e); });
  const release = (e) => {
    if (e.pointerId !== active) return;
    active = null;
    pad.classList.remove('dragging');
    if (!joy.hold) setStick(0, 0);           // retour au centre, sauf si "Garder la position"
  };
  pad.addEventListener('pointerup', release);
  pad.addEventListener('pointercancel', release);

  const bindRange = (id, key, fmt) => {
    const input = $(id);
    input.addEventListener('input', () => {
      joy[key] = Number(input.value);
      $(`${id}-val`).textContent = fmt(joy[key]);
    });
  };
  bindRange('joy-roll', 'roll', (v) => `${v}°`);
  bindRange('joy-pumpA', 'pumpA', (v) => `${v}`);
  bindRange('joy-pumpB', 'pumpB', (v) => `${v}`);
  // Double appui sur l'inclinaison : retour à 0
  $('joy-roll').addEventListener('dblclick', () => {
    $('joy-roll').value = 0; joy.roll = 0; $('joy-roll-val').textContent = '0°';
  });

  $('joy-hold').addEventListener('click', () => {
    joy.hold = !joy.hold;
    $('joy-hold').classList.toggle('active', joy.hold);
    if (!joy.hold && active === null) setStick(0, 0);
  });
  $('joy-center').addEventListener('click', () => {
    setStick(0, 0);
    for (const [id, key, txt] of [['joy-roll', 'roll', '0°'], ['joy-pumpA', 'pumpA', '0'], ['joy-pumpB', 'pumpB', '0']]) {
      $(id).value = 0; joy[key] = 0; $(`${id}-val`).textContent = txt;
    }
  });
}

// ------------------------------------------------------------
// Connexion BLE
// ------------------------------------------------------------
link.onState = (state) => {
  $('btn-connect').dataset.state = state;
  $('conn-label').textContent = state === 'connected' ? 'Connecté' : state === 'connecting' ? 'Connexion' : 'Connecter';
  if (state === 'connected' && app.desiredMode !== null) link.sendMode(app.desiredMode, 2);
  if (state !== 'connected') {
    app.robotMode = null;   // le robot passe seul en aléatoire
    app.status = null;
    $('stats').textContent = '—';
  }
  render();
};

link.onStatus = (st) => {
  app.robotMode = st.mode;
  app.status = st;
  $('stats').textContent = `${st.rxPerSec} msg/s · ${st.lostPerSec} perdus/s · ${st.crcErrors} erreurs`;
  render();
};

$('btn-connect').addEventListener('click', async () => {
  if (link.connected) return;
  try {
    await link.choose();
  } catch (err) {
    if (err.name !== 'NotFoundError') $('conn-label').textContent = 'Erreur';
  }
});

// ------------------------------------------------------------
// Réglages
// ------------------------------------------------------------
const settingsSheet = $('sheet-settings');
$('btn-settings').addEventListener('click', () => { settingsSheet.hidden = false; });
settingsSheet.querySelector('[data-close]').addEventListener('click', () => { settingsSheet.hidden = true; });
settingsSheet.addEventListener('click', (e) => { if (e.target === settingsSheet) settingsSheet.hidden = true; });

function bindSettings() {
  for (const key of ['gainPitch', 'gainRoll', 'gainYaw']) {
    const input = $(key);
    const out = $(`${key}-val`);
    input.value = settings[key];
    out.textContent = Number(settings[key]).toFixed(1);
    input.addEventListener('input', () => {
      settings[key] = parseFloat(input.value);
      out.textContent = settings[key].toFixed(1);
      saveSettings(settings);
    });
  }
  for (const key of ['invertPitch', 'invertRoll', 'invertYaw', 'pumpsEnabled']) {
    const input = $(key);
    input.checked = !!settings[key];
    input.addEventListener('change', () => {
      settings[key] = input.checked;
      saveSettings(settings);
    });
  }
}

// ------------------------------------------------------------
// Écran allumé + arrière-plan
// ------------------------------------------------------------
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { /* refusé : sans gravité */ }
}
document.addEventListener('click', keepAwake);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    tracker.stop();          // en arrière-plan : plus de caméra, le robot revient au neutre
  } else {
    keepAwake();
    if (app.desiredMode === MODE.MIMIC) setMode(MODE.MIMIC);
  }
});

// ------------------------------------------------------------
// Démarrage
// ------------------------------------------------------------
bindSettings();
initQr();
initJoystick();
render();
if (!RobotLink.supported()) {
  $('conn-label').textContent = 'Chrome requis';
  $('btn-connect').disabled = true;
} else {
  $('conn-label').textContent = 'Connecter';
  link.tryRemembered();
}
