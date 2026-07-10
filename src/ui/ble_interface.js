/**
 * BLE Interface — Single entry point that loads all BLE modules in order
 * v5.2.2  (Replaces the 4-file split for webpack bundling)
 * Import order: base → native → protocol → ui
 * All modules extend BLEInterface.prototype via Object.assign
   */
// Load base (defines BLEInterface class + helpers)
import { BLEInterface } from './ble_base.js';
// Load native (extends prototype with scan, connection, advertising)
// Side-effect: mutates BLEInterface.prototype
import './ble_native.js';
// Load protocol (extends prototype with messages, ACK, heartbeat)
// Side-effect: mutates BLEInterface.prototype
import './ble_protocol.js';
// Load UI (extends prototype with DOM, render, events)
// Side-effect: mutates BLEInterface.prototype
import { initBLEInterface } from './ble_ui.js';
export { BLEInterface, initBLEInterface };
