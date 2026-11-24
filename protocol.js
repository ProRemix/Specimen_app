// ============================================================
// PROTOCOLE - équivalent JS de firmware/*/protocol.h
// ============================================================

export const BLE = {
  NAME: 'RobotHead',
  SERVICE: '6e1a0001-4b52-4f42-9a7e-2f6d1c0b5a10',
  CONTROL: '6e1a0002-4b52-4f42-9a7e-2f6d1c0b5a10',
  STATUS: '6e1a0003-4b52-4f42-9a7e-2f6d1c0b5a10',
};

export const MODE = { STOP: 0, RANDOM: 1, MIMIC: 2, ANIM: 3, MANUAL: 4 };
export const MODE_LABEL = { 0: 'Stop', 1: 'Aléatoire', 2: 'Mimétisme', 3: 'Animations', 4: 'Joystick' };

// Animations préenregistrées (même ordre que l'enum Animation du firmware)
export const ANIMS = [
  { id: 0, name: 'Oui', hint: 'Hochement' },
  { id: 1, name: 'Non', hint: 'Secoue la tête' },
  { id: 2, name: 'Content', hint: 'Rebonds' },
  { id: 3, name: 'Timide', hint: 'Détourne le regard' },
  { id: 4, name: 'Curieux', hint: 'Penche la tête' },
  { id: 5, name: 'Surpris', hint: 'Sursaut' },
  { id: 6, name: 'Triste', hint: 'Baisse la tête' },
  { id: 7, name: 'Fâché', hint: 'Secousses' },
];
export const ANIM_NONE = 255;

const PKT_MODE = 0x01;
const PKT_MIMIC = 0x02;
const PKT_ANIM = 0x03;

export function crc8(bytes, len = bytes.length) {
  let crc = 0;
  for (let i = 0; i < len; i++) {
    crc ^= bytes[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

let seq = 0;
const nextSeq = () => (seq = (seq + 1) & 0xff);

const clampByte = (v) => Math.max(0, Math.min(255, Math.round(v)));
const toDeci = (deg) => Math.max(-32768, Math.min(32767, Math.round(deg * 10)));

export function encodeMode(mode) {
  const b = new Uint8Array(4);
  b[0] = PKT_MODE;
  b[1] = nextSeq();
  b[2] = mode;
  b[3] = crc8(b, 3);
  return b;
}

let trigger = 0;
export function encodeAnim(animId) {
  trigger = (trigger + 1) & 0xff;
  return encodeAnimWithTrigger(animId, trigger);
}
// Même déclencheur = même appui : le robot ne rejoue pas l'animation
export function encodeAnimWithTrigger(animId, trig) {
  const b = new Uint8Array(5);
  b[0] = PKT_ANIM;
  b[1] = nextSeq();
  b[2] = animId;
  b[3] = trig;
  b[4] = crc8(b, 4);
  return b;
}
export const lastAnimTrigger = () => trigger;

export const EXPR = { NEUTRAL: 0, JOY: 1, SURPRISE: 2, ANGER: 3, SADNESS: 4 };
export const EXPR_LABEL = { 0: 'Neutre', 1: 'Joie', 2: 'Surprise', 3: 'Colère', 4: 'Tristesse' };

// m = { face, pitch, roll, yaw (degrés), expression (EXPR), intensity (0..1) }
export function encodeMimic(m) {
  const buf = new ArrayBuffer(12);
  const v = new DataView(buf);
  const b = new Uint8Array(buf);
  b[0] = PKT_MIMIC;
  b[1] = nextSeq();
  b[2] = m.face ? 0x01 : 0x00;
  v.setInt16(3, toDeci(m.pitch), true);
  v.setInt16(5, toDeci(m.roll), true);
  v.setInt16(7, toDeci(m.yaw), true);
  b[9] = m.expression & 0xff;
  b[10] = clampByte(m.intensity * 255);
  b[11] = crc8(b, 11);
  return b;
}

// Joystick : même message que le mimétisme, octets 9/10 = pompes A/B (0..255)
export function encodeManual(m) {
  const b = encodeMimic({ face: true, pitch: m.pitch, roll: m.roll, yaw: m.yaw, expression: 0, intensity: 0 });
  b[9] = clampByte(m.pumpA);
  b[10] = clampByte(m.pumpB);
  b[11] = crc8(b, 11);
  return b;
}

export function decodeStatus(dataView) {
  if (dataView.byteLength < 5) return null;
  return {
    mode: dataView.getUint8(0),
    rxPerSec: dataView.getUint8(1),
    lostPerSec: dataView.getUint8(2),
    crcErrors: dataView.getUint8(3),
    macroState: dataView.getUint8(4),
    pumpMood: dataView.byteLength > 5 ? dataView.getUint8(5) : null,
    anim: dataView.byteLength > 6 ? dataView.getUint8(6) : ANIM_NONE,
  };
}
