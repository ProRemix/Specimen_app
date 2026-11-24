// ============================================================
// APPLI ROBOT - modes Aléatoire / Mimétisme + STOP
// ============================================================
import { CONFIG, loadSettings, saveSettings } from './config.js';
import { MODE, MODE_LABEL, EXPR, EXPR_LABEL } from './protocol.js';
import { RobotLink } from './ble.js';
import { FaceTracker } from './tracker.js';
import { OneEuro } from './filters.js';
import { ExpressionDetector } from './expressions.js';

const $ = (id) => document.getElementById(id);

const PUMP_MOOD_LABEL = {
  0: 'repos', 1: 'alerte', 2: 'curiosité', 3: 'défense', 4: 'vibration', 5: 'goutte-à-goutte', 6: 'saccades',
  10: 'calme', 11: 'emballement', 12: 'retour au calme',
};

const link = new RobotLink();
const tracker = new FaceTracker($('vid'), $('mesh'));
const detector = new ExpressionDetector();
let settings = loadSettings();

const app = {
  desiredMode: null,      // mode choisi sur le téléphone (null = rien demandé)
  robotMode: null,        // mode confirmé par le robot
  calib: null,            // pose de référence (bouton Recentrer)
  shouldCalibrate: false,
  last: null,             // dernière mesure filtrée
  lastFaceT: 0,
};

const filters = {
  pitch: new OneEuro(CONFIG.oneEuro),
  roll: new OneEuro(CONFIG.oneEuro),
  yaw: new OneEuro(CONFIG.oneEuro),
};
const resetFilters = () => Object.values(filters).forEach((f) => f.reset());

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Écart à la pose de référence, ramené entre -180 et 180
const rel = (a, b) => ((((a - b) % 360) + 540) % 360) - 180;

const NEUTRAL_PACKET = { face: false, pitch: 0, roll: 0, yaw: 0, expression: EXPR.NEUTRAL, intensity: 0 };

// ------------------------------------------------------------
// Mesure -> valeurs robot
// ------------------------------------------------------------
tracker.onFrame = (f) => {
  if (!f.face) {
    $('face-state').textContent = 'Aucun visage';
    return;
  }
  app.lastFaceT = f.t;
  $('face-state').textContent = 'Visage détecté';

  if (app.shouldCalibrate || !app.calib) {
    app.calib = { pitch: f.pitch, roll: f.roll, yaw: f.yaw };
    detector.calibrate(f.bs);
    app.shouldCalibrate = false;
    resetFilters();
  }

  // Tête
  const s = settings;
  const sign = (inv) => (inv ? -1 : 1);
  const pitch = clamp(rel(f.pitch, app.calib.pitch) * s.gainPitch * sign(s.invertPitch), -CONFIG.limits.pitch, CONFIG.limits.pitch);
  const roll = clamp(rel(f.roll, app.calib.roll) * s.gainRoll * sign(s.invertRoll), -CONFIG.limits.roll, CONFIG.limits.roll);
  const yaw = clamp(rel(f.yaw, app.calib.yaw) * s.gainYaw * sign(s.invertYaw), -CONFIG.limits.yaw, CONFIG.limits.yaw);

  // Expression -> pompes
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

// ------------------------------------------------------------
// Boucle d'envoi 50 Hz
// ------------------------------------------------------------
setInterval(() => {
  if (app.desiredMode !== MODE.MIMIC || !link.connected) return;
  const fresh = app.last && performance.now() / 1000 - app.lastFaceT < CONFIG.FACE_LOST_MS / 1000;
  link.sendMimic(fresh ? app.last : NEUTRAL_PACKET);
}, CONFIG.SEND_PERIOD_MS);

// Le mode choisi est renvoyé régulièrement (robot redémarré, message perdu, reconnexion)
setInterval(() => {
  if (app.desiredMode !== null && link.connected) link.sendMode(app.desiredMode);
  $('fps').textContent = tracker.running ? `${tracker.fps} img/s` : '–';
}, CONFIG.MODE_RESEND_MS);

// ------------------------------------------------------------
// Modes
// ------------------------------------------------------------
async function setMode(mode) {
  app.desiredMode = mode;
  link.sendMode(mode, mode === MODE.STOP ? CONFIG.STOP_REPEAT : 2);
  renderModes();

  if (mode === MODE.MIMIC) {
    $('camera').classList.add('on');
    try {
      $('face-state').textContent = 'Chargement du suivi…';
      await tracker.start();
      app.calib = null;   // recentrage automatique sur la première image
    } catch (err) {
      $('face-state').textContent = `Caméra indisponible : ${err.message}`;
    }
  } else {
    tracker.stop();
    $('camera').classList.remove('on');
    app.last = null;
  }
}

function renderModes() {
  for (const [id, mode] of [['btn-random', MODE.RANDOM], ['btn-mimic', MODE.MIMIC]]) {
    $(id).classList.toggle('selected', app.desiredMode === mode);
    $(id).classList.toggle('confirmed', app.robotMode === mode);
  }
  $('robot-mode').textContent = app.robotMode === null ? '–' : MODE_LABEL[app.robotMode];
  $('robot-mode').dataset.mode = app.robotMode ?? '';
}

$('btn-random').addEventListener('click', () => setMode(MODE.RANDOM));
$('btn-mimic').addEventListener('click', () => setMode(MODE.MIMIC));
$('btn-stop').addEventListener('click', () => {
  if (navigator.vibrate) navigator.vibrate(60);
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
  const hidden = vid.style.opacity === '0';
  vid.style.opacity = hidden ? '1' : '0';
  $('btn-mesh').classList.toggle('active', !hidden);
});

// ------------------------------------------------------------
// Connexion BLE
// ------------------------------------------------------------
link.onState = (state) => {
  $('conn').dataset.state = state;
  $('conn-label').textContent =
    state === 'connected' ? 'Connecté' : state === 'connecting' ? 'Connexion…' : 'Déconnecté';
  $('btn-connect').hidden = state === 'connected';
  if (state === 'connected' && app.desiredMode !== null) link.sendMode(app.desiredMode, 2);
  if (state !== 'connected') {
    app.robotMode = null;   // le robot passe seul en aléatoire
    $('stats').textContent = '–';
    renderModes();
  }
};

link.onStatus = (st) => {
  app.robotMode = st.mode;
  const mood = st.pumpMood !== null && st.mode !== MODE.STOP ? ` · pompes : ${PUMP_MOOD_LABEL[st.pumpMood] ?? '?'}` : '';
  $('stats').textContent = `${st.rxPerSec} msg/s · ${st.lostPerSec} perdus/s · ${st.crcErrors} erreurs${mood}`;
  renderModes();
};

$('btn-connect').addEventListener('click', async () => {
  try {
    await link.choose();
  } catch (err) {
    if (err.name !== 'NotFoundError') $('conn-label').textContent = `Erreur : ${err.message}`;
  }
});

// ------------------------------------------------------------
// Réglages
// ------------------------------------------------------------
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
renderModes();
if (!RobotLink.supported()) {
  $('conn-label').textContent = 'Bluetooth web indisponible : ouvre la page dans Chrome Android (HTTPS)';
  $('btn-connect').disabled = true;
} else {
  link.tryRemembered();
}
