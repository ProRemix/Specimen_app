// ============================================================
// SUIVI DU VISAGE - MediaPipe Face Landmarker
// Angles de la tête : même calcul que ton mobile-core.js
// (points 234/454/10/152 + yeux 130/359).
// En plus : blendshapes (expressions du visage) pour les pompes.
// ============================================================
import { FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Repris de CONFIG.TRACKING.landmarks
const LM = { left: 234, right: 454, top: 10, bottom: 152, eyeLeft: 130, eyeRight: 359 };

// Dessin du mesh : un seul maillage fin, monochrome. Les arêtes les plus
// proches de la caméra sont plus lumineuses, ce qui donne du relief.
const MESH_ALPHA = [0.07, 0.16, 0.32];   // loin -> près
const OVAL_ALPHA = 0.55;

const DEG = 180 / Math.PI;
const getPoint = (lms, i, w, h) => ({ x: lms[i].x * w, y: lms[i].y * h, z: lms[i].z * w });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const normalize = (v) => {
  const l = Math.hypot(v.x, v.y, v.z);
  return l === 0 ? v : { x: v.x / l, y: v.y / l, z: v.z / l };
};

// Même formule que processTracking() : angles bruts en degrés
function headAngles(lms, w, h) {
  const pl = getPoint(lms, LM.left, w, h);
  const pr = getPoint(lms, LM.right, w, h);
  const pt = getPoint(lms, LM.top, w, h);
  const pb = getPoint(lms, LM.bottom, w, h);
  const right = normalize(sub(pr, pl));
  const up = normalize(sub(pt, pb));
  const f = normalize(cross(right, up));
  const fwd = { x: -f.x, y: -f.y, z: -f.z };
  const yaw = Math.atan2(fwd.x, -fwd.z) * DEG;
  const pitch = Math.atan2(fwd.y, -fwd.z) * DEG;
  const ve = sub(getPoint(lms, LM.eyeRight, w, h), getPoint(lms, LM.eyeLeft, w, h));
  const roll = Math.atan2(ve.y, ve.x) * DEG;
  return { yaw, pitch, roll };
}

export class FaceTracker {
  constructor(video, canvas) {
    this.video = video;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.onFrame = () => {};     // ({ face, pitch, roll, yaw, bs, t })
    this.fps = 0;
    this._frames = 0;
    this._fpsT = performance.now();
    this._lastVideoTime = -1;
  }

  async load() {
    if (this.landmarker) return;
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
    });
    try {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      this.landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  async start() {
    if (this.running || this._starting) return;
    this._starting = true;
    try {
      await this.load();
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.running = true;
      this._loop();
    } finally {
      this._starting = false;
    }
  }

  stop() {
    this.running = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.fps = 0;
  }

  _loop() {
    if (!this.running) return;
    const v = this.video;
    // Même garde que ton render() : pas d'image tant que la vidéo n'est pas prête
    if (v.readyState >= 2 && v.videoWidth > 0 && v.currentTime !== this._lastVideoTime) {
      this._lastVideoTime = v.currentTime;
      const now = performance.now();
      this._handle(this.landmarker.detectForVideo(v, now), now);
      this._countFps(now);
    }
    requestAnimationFrame(() => this._loop());
  }

  _countFps(now) {
    this._frames++;
    if (now - this._fpsT >= 1000) {
      this.fps = Math.round((this._frames * 1000) / (now - this._fpsT));
      this._frames = 0;
      this._fpsT = now;
    }
  }

  _drawMesh(lms, w, h) {
    const ctx = this.ctx;
    const unit = Math.max(w, h) / 640;      // épaisseur constante quelle que soit la résolution
    const tess = FaceLandmarker.FACE_LANDMARKS_TESSELATION;
    if (!tess) return;

    // Profondeur : z plus petit = plus proche. On répartit les arêtes en 3 niveaux.
    let zMin = Infinity, zMax = -Infinity;
    for (let i = 0; i < 468 && i < lms.length; i++) {
      if (lms[i].z < zMin) zMin = lms[i].z;
      if (lms[i].z > zMax) zMax = lms[i].z;
    }
    const span = zMax - zMin || 1;
    const buckets = [new Path2D(), new Path2D(), new Path2D()];
    for (const c of tess) {
      const a = lms[c.start];
      const b = lms[c.end];
      if (!a || !b) continue;
      const near = 1 - ((a.z + b.z) / 2 - zMin) / span;      // 0 loin, 1 près
      const k = near > 0.66 ? 2 : near > 0.33 ? 1 : 0;
      buckets[k].moveTo(a.x * w, a.y * h);
      buckets[k].lineTo(b.x * w, b.y * h);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 0.55 * unit;
    buckets.forEach((path, k) => {
      ctx.strokeStyle = `rgba(255, 255, 255, ${MESH_ALPHA[k]})`;
      ctx.stroke(path);
    });

    // Contour du visage, discret
    const oval = FaceLandmarker.FACE_LANDMARKS_FACE_OVAL;
    if (oval) {
      const p = new Path2D();
      for (const c of oval) {
        const a = lms[c.start];
        const b = lms[c.end];
        if (!a || !b) continue;
        p.moveTo(a.x * w, a.y * h);
        p.lineTo(b.x * w, b.y * h);
      }
      ctx.strokeStyle = `rgba(255, 255, 255, ${OVAL_ALPHA})`;
      ctx.lineWidth = 0.9 * unit;
      ctx.stroke(p);
    }
  }

  _handle(res, now) {
    const c = this.canvas;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    this.ctx.clearRect(0, 0, w, h);

    if (!res.faceLandmarks || res.faceLandmarks.length === 0) {
      this.onFrame({ face: false, t: now / 1000 });
      return;
    }
    const lms = res.faceLandmarks[0];

    this._drawMesh(lms, w, h);

    const bs = {};
    if (res.faceBlendshapes && res.faceBlendshapes[0]) {
      for (const cat of res.faceBlendshapes[0].categories) bs[cat.categoryName] = cat.score;
    }
    this.onFrame({ face: true, ...headAngles(lms, w, h), bs, t: now / 1000 });
  }
}
