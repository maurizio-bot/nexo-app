/**
 * ble_rid.js v1.0 (ronda 2755, plan del dueño punto 4) — ID Bluetooth rotativo.
 * Antes cada teléfono anunciaba su NEXO ID en el aire: cualquiera con un escáner podía seguir a una persona.
 * Ahora anuncia un código que cambia cada 15 min y que solo reconocen sus contactos:
 *   clave = SHA-256("nexo-rid-key|" + clave pública E2E)        (los contactos la tienen; un extraño no)
 *   código = "R" + base32(HMAC-SHA256(clave, "nexo-rid|" + época))[0..9]   época = segundos / 900
 * La parte nativa (BleService, RidToken.kt) calcula el mismo código y lo cambia sola aunque la app esté cerrada.
 * Las builds anteriores esperan "NX…" y lo ignoran sin más (siguen viéndonos al conectar nosotros con ellas).
 * El NEXO ID se anuncia (visible) solo mientras está abierto "Agregar" (5 min) o si aún no hay contactos.
 */
var B32 = 'abcdefghijklmnopqrstuvwxyz234567';
export var RID_VISIBLE_MS = 5 * 60000;

function _epochS() { return (typeof window !== 'undefined' && Number(window.NEXO_RID_EPOCH_S)) || 900; }
function _hex(u8) { return Array.from(u8).map(function(b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
function _unhex(h) { var o = new Uint8Array(h.length / 2); for (var i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; }
function _utf8(s) { return new TextEncoder().encode(s); }
function _subtle() { return (typeof crypto !== 'undefined' && crypto.subtle) || null; }

export function ridEpoch(now) { return Math.floor((now || Date.now()) / 1000 / _epochS()); }
export function ridEpochSeconds() { return _epochS(); }
export function ridIsToken(s) { return typeof s === 'string' && s.length === 10 && s.charAt(0) === 'R' && /^R[a-z2-7]{9}$/.test(s); }

// Clave de los códigos de quien tiene esta clave pública (hex, 64)
export async function ridKey(pubB64) {
  if (!pubB64 || !_subtle()) return null;
  return _hex(new Uint8Array(await _subtle().digest('SHA-256', _utf8('nexo-rid-key|' + pubB64))));
}

export async function ridToken(keyHex, epoch) {
  var k = await _subtle().importKey('raw', _unhex(keyHex), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  var h = new Uint8Array(await _subtle().sign('HMAC', k, _utf8('nexo-rid|' + epoch)));
  // 9 caracteres de 5 bits = 45 bits
  var out = 'R', acc = 0, bits = 0, i = 0;
  while (out.length < 10) {
    acc = (acc << 8) | h[i++]; bits += 8;
    while (bits >= 5 && out.length < 10) { bits -= 5; out += B32.charAt((acc >> bits) & 31); }
    acc &= (1 << bits) - 1;
  }
  return out;
}

// Códigos de los contactos de la época anterior, la actual y la siguiente (relojes algo desfasados)
export class RidBook {
  constructor() { this.map = new Map(); this.epoch = -1; this.sig = ''; this._busy = null; }
  // contacts: [{ nexoId, publicKey }]
  async refresh(contacts, force) {
    var e = ridEpoch(), list = (contacts || []).filter(function(c) { return c && c.publicKey && (c.nexoId || c.deviceUUID); });
    var sig = list.map(function(c) { return (c.nexoId || c.deviceUUID) + ':' + c.publicKey; }).join(',');
    if (!force && e === this.epoch && sig === this.sig) return;
    if (this._busy) return this._busy;
    var self = this;
    this._busy = (async function() {
      var m = new Map();
      for (var i = 0; i < list.length; i++) {
        var key = await ridKey(list[i].publicKey);
        if (!key) continue;
        for (var d = -1; d <= 1; d++) m.set(await ridToken(key, e + d), list[i].nexoId || list[i].deviceUUID);
      }
      self.map = m; self.epoch = e; self.sig = sig;
    })().finally(function() { self._busy = null; });
    return this._busy;
  }
  lookup(token) { return this.map.get(token) || null; }
  // Para Jump: los códigos de ahora de un contacto (el puente los busca al escanear)
  async tokensFor(pubB64) {
    var key = await ridKey(pubB64), e = ridEpoch();
    if (!key) return [];
    return [await ridToken(key, e - 1), await ridToken(key, e), await ridToken(key, e + 1)];
  }
}
