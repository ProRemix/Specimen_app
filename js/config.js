// ============================================================
// RÉGLAGES DE L'APPLI
// Les gains et inversions sont modifiables dans l'écran Réglages
// et gardés dans le téléphone (localStorage).
// ============================================================

export const CONFIG = {
  SEND_PERIOD_MS: 20,        // 50 Hz en mimétisme
  MODE_RESEND_MS: 1000,      // le mode choisi est renvoyé chaque seconde
  STOP_REPEAT: 3,            // STOP envoyé 3 fois
  FACE_LOST_MS: 300,         // au-delà, "visage perdu" -> robot au neutre

  // Limites envoyées (le robot a aussi les siennes)
  limits: { pitch: 35, roll: 25, yaw: 45 },

  // Lissage One Euro (plus minCutoff est bas, plus c'est lisse au repos ;
  // plus beta est haut, moins il y a de retard sur les gestes rapides)
  oneEuro: { minCutoff: 1.0, beta: 0.05, dCutoff: 1.0 },

  // Détection des expressions (pilote les pompes en mimétisme)
  expressions: {
    minScore: 0.2,       // en dessous : visage neutre, pompes au repos
    holdMs: 200,         // une nouvelle expression doit tenir ce temps avant d'être adoptée
    // Amplification par expression (certaines sont naturellement plus faibles)
    gain: { joy: 1.3, surprise: 1.8, anger: 2.2, sadness: 2.5 },
  },
};

// Valeurs réglables à l'écran (par défaut : mode direct, comme ton module Mimic)
export const DEFAULT_SETTINGS = {
  gainPitch: 1.0,
  gainRoll: 1.0,
  gainYaw: 1.0,
  invertPitch: false,
  invertRoll: false,
  invertYaw: false,      // à cocher si la tête tourne à l'envers
  pumpsEnabled: true,
};

const KEY = 'robot-settings-v1';

export function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ }
}
