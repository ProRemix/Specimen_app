// ============================================================
// EXPRESSIONS FACIALES à partir des blendshapes MediaPipe
// Joie, surprise, colère, tristesse -> expression dominante + intensité
// ============================================================
import { CONFIG } from './config.js';
import { EXPR } from './protocol.js';
import { OneEuro } from './filters.js';

const v = (bs, name) => bs[name] || 0;
const avg = (bs, a, b) => (v(bs, a) + v(bs, b)) / 2;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Scores bruts 0..1
function rawScores(bs) {
  return {
    joy: avg(bs, 'mouthSmileLeft', 'mouthSmileRight'),
    surprise: (v(bs, 'browInnerUp') + avg(bs, 'eyeWideLeft', 'eyeWideRight') + v(bs, 'jawOpen')) / 3,
    anger: (avg(bs, 'browDownLeft', 'browDownRight') + avg(bs, 'noseSneerLeft', 'noseSneerRight')
      + avg(bs, 'mouthPressLeft', 'mouthPressRight')) / 3,
    sadness: avg(bs, 'mouthFrownLeft', 'mouthFrownRight') * 0.7 + v(bs, 'browInnerUp') * 0.3,
  };
}

const CODE = { joy: EXPR.JOY, surprise: EXPR.SURPRISE, anger: EXPR.ANGER, sadness: EXPR.SADNESS };

export class ExpressionDetector {
  constructor() {
    this.baseline = null;
    this.current = EXPR.NEUTRAL;
    this.candidate = EXPR.NEUTRAL;
    this.candidateSince = 0;
    this.intensityFilter = new OneEuro({ minCutoff: 1.5, beta: 0.3, dCutoff: 1.0 });
    this.scores = { joy: 0, surprise: 0, anger: 0, sadness: 0 };
  }

  // Le visage actuel devient la référence "neutre" (bouton Recentrer)
  calibrate(bs) {
    this.baseline = rawScores(bs);
    this.current = EXPR.NEUTRAL;
    this.candidate = EXPR.NEUTRAL;
    this.intensityFilter.reset();
  }

  // t en secondes ; renvoie { expression, intensity (0..1), scores }
  update(bs, t) {
    const raw = rawScores(bs);
    if (!this.baseline) this.baseline = raw;
    const { gain, minScore, holdMs } = CONFIG.expressions;

    let best = 'neutral';
    let bestScore = 0;
    for (const k of Object.keys(raw)) {
      const base = Math.min(this.baseline[k], 0.9);
      const s = clamp01(((raw[k] - base) / (1 - base)) * gain[k]);
      this.scores[k] = s;
      if (s > bestScore) { best = k; bestScore = s; }
    }
    const winner = bestScore >= minScore ? CODE[best] : EXPR.NEUTRAL;

    // Hystérésis : une nouvelle expression doit tenir holdMs avant d'être adoptée
    if (winner !== this.candidate) {
      this.candidate = winner;
      this.candidateSince = t;
    }
    if (this.candidate !== this.current && (t - this.candidateSince) * 1000 >= holdMs) {
      this.current = this.candidate;
    }

    const key = Object.keys(CODE).find((k) => CODE[k] === this.current);
    const target = key ? this.scores[key] : 0;
    const intensity = clamp01(this.intensityFilter.filter(target, t));
    return { expression: this.current, intensity, scores: this.scores };
  }
}
