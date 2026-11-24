// ============================================================
// LIAISON BLE (Web Bluetooth, Chrome Android)
// Remplace socket.emit(...) vers le serveur.
// ============================================================
import { BLE, encodeMode, encodeMimic, decodeStatus } from './protocol.js';

export class RobotLink {
  constructor() {
    this.device = null;
    this.control = null;
    this.connected = false;
    this.wantConnected = false;
    this.busy = false;
    this.queue = [];             // messages importants (modes), jamais perdus
    this.onState = () => {};     // (state: 'disconnected'|'connecting'|'connected')
    this.onStatus = () => {};    // (status décodé)
    this._retryTimer = null;
  }

  static supported() {
    return !!(navigator.bluetooth && navigator.bluetooth.requestDevice);
  }

  // Doit être appelé depuis un clic (exigence du navigateur)
  async choose() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [BLE.SERVICE] }],
    });
    this._attach(device);
    await this._connectGatt();
  }

  // Reconnexion silencieuse au dernier robot autorisé, si le navigateur le permet
  async tryRemembered() {
    if (!navigator.bluetooth.getDevices) return false;
    try {
      const devices = await navigator.bluetooth.getDevices();
      const robot = devices.find((d) => d.name === BLE.NAME) || devices[0];
      if (!robot) return false;
      this._attach(robot);
      await this._connectGatt();
      return true;
    } catch {
      this._scheduleRetry();
      return false;
    }
  }

  _attach(device) {
    if (this.device === device) return;
    if (this.device) this.device.removeEventListener('gattserverdisconnected', this._onDisc);
    this.device = device;
    this.wantConnected = true;
    this._onDisc = () => this._handleDisconnect();
    device.addEventListener('gattserverdisconnected', this._onDisc);
  }

  async _connectGatt() {
    this.onState('connecting');
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(BLE.SERVICE);
    this.control = await service.getCharacteristic(BLE.CONTROL);
    const status = await service.getCharacteristic(BLE.STATUS);
    status.addEventListener('characteristicvaluechanged', (e) => {
      const s = decodeStatus(e.target.value);
      if (s) this.onStatus(s);
    });
    await status.startNotifications();
    this.connected = true;
    this.busy = false;
    this.onState('connected');
  }

  _handleDisconnect() {
    this.connected = false;
    this.control = null;
    this.onState('disconnected');
    this._scheduleRetry();
  }

  _scheduleRetry(delay = 1500) {
    if (!this.wantConnected || !this.device || this._retryTimer) return;
    this._retryTimer = setTimeout(async () => {
      this._retryTimer = null;
      if (this.connected || !this.wantConnected) return;
      try {
        await this._connectGatt();
      } catch {
        this.onState('disconnected');
        this._scheduleRetry(Math.min(delay * 1.5, 5000));
      }
    }, delay);
  }

  disconnect() {
    this.wantConnected = false;
    if (this.device && this.device.gatt.connected) this.device.gatt.disconnect();
  }

  // --- Envoi ---
  async _write(bytes) {
    this.busy = true;
    try {
      await this.control.writeValueWithoutResponse(bytes);
    } catch {
      /* lien coupé : la reconnexion s'en charge */
    } finally {
      this.busy = false;
      if (this.queue.length && this.connected) this._write(this.queue.shift());
    }
  }

  sendMode(mode, repeat = 1) {
    if (!this.connected) return false;
    for (let i = 0; i < repeat; i++) this.queue.push(encodeMode(mode));
    if (!this.busy) this._write(this.queue.shift());
    return true;
  }

  // Valeurs de mimétisme : si le lien est occupé on saute, la suivante arrive dans 20 ms
  sendMimic(values) {
    if (!this.connected || this.busy || this.queue.length) return false;
    this._write(encodeMimic(values));
    return true;
  }
}
