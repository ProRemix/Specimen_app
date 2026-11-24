// ============================================================
// PROTOCOLE - équivalent JS de firmware/*/protocol.h
// ============================================================

export const BLE = {
  NAME: 'RobotHead',
  SERVICE: '6e1a0001-4b52-4f42-9a7e-2f6d1c0b5a10',
  CONTROL: '6e1a0002-4b52-4f42-9a7e-2f6d1c0b5a10',
  STATUS: '6e1a0003-4b52-4f42-9a7e-2f6d1c0b5a10',
};

export const MODE = { STOP: 0, RANDOM: 1, MIMIC: 2 };
export const MODE_LABEL = { 0: 'STOP', 1: 'Aléatoire', 2: 'Mimétisme' };

const PKT_MODE = 0x01;
const PKT_MIMIC = 0x02;

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

export function decodeStatus(dataView) {
  if (dataView.byteLength < 5) return null;
  return {
    mode: dataView.getUint8(0),
    rxPerSec: dataView.getUint8(1),
    lostPerSec: dataView.getUint8(2),
    crcErrors: dataView.getUint8(3),
    macroState: dataView.getUint8(4),
    pumpMood: dataView.byteLength > 5 ? dataView.getUint8(5) : null,
  };
}
