/**
 * fenix_entorno.js v1.0 (3148) — Fénix Entorno, fase 1. OCULTO: solo actúa con el interruptor de desarrollo encendido
 * (feEnabled; en las APK con número de build está siempre apagado). Apagado, lo que llega se ignora y se apunta en el registro.
 *
 * Principio A: la cuenta que vuelve NO es la llave vieja. El teléfono nuevo conserva su identidad nueva y anuncia un «registro de
 * sucesión» (k 'fs'): NEXO ID + llave vieja (ik, sk) → llave nueva (ik, sk), con época (ep), hora (ts), número único (n), la lista de
 * guardianes firmada por la llave vieja (ros, hecha por el teléfono viejo al respaldar) y las «atestaciones» de los guardianes
 * (cada una firmada con la llave de firma ECDSA de ese guardián). Todo firmado con la llave de firma nueva.
 * Los contactos lo aceptan solo si: firma buena; la llave vieja es la que ELLOS tienen; la época es justo la siguiente; el número no
 * se vio; la hora es razonable; y hay al menos t atestaciones válidas de guardianes distintos que ellos pueden comprobar (los suyos
 * propios o los de la lista firmada por la llave vieja). Aceptado: la llave nueva pasa a ser la del contacto con marca visible
 * (recoveredAt, en rojo hasta verificar el número de seguridad). Nunca se cambia una llave sin este registro (sigue el «clave cambiada»).
 * Principio B (veto, k 'fv'): el teléfono viejo firma «no soy yo» con su llave (pide el desbloqueo de NEXO si el usuario lo tiene).
 * Gana la prueba más fuerte (rango 1 = más fuerte): 1 teléfono viejo con desbloqueo; 2 guardianes con retrato y firma vivos (fases
 * siguientes); 3 teléfono viejo sin desbloqueo; 4 solo atestaciones (fase 1). Un veto que gana: antes de aceptar, el registro de esa
 * época y anterior al veto se rechaza; después, se vuelve a la llave vieja con aviso. Si la llave vieja sigue hablando tras una
 * sucesión aceptada: aviso rojo de conflicto (no se confía en ninguna de las dos sin verificar) y se le reenvía el registro a ese
 * teléfono para que pueda vetar.
 * Formato de los textos firmados: etiquetas 'NEXO-FE-*' (no se pueden confundir con otras firmas del protocolo 2).
 */
import { e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { ratchetForget, ratchetMySigningKey, ratchetPeerBundle, ratchetSignFe } from '../vault/e2e_ratchet.js';
import { _recWindowOk } from './fenix_pure.js';
import { t } from '../ui/i18n.js';

export var FE_ON_DEFAULT = false;          // el interruptor: apagado para todos
var FE_FILE = 'nexo_fenix_entorno.json';
var DEV_KEY = 'nexo_dev_fenix_entorno';
var MIN = 60000, DAY = 86400000;
var FUTURE_MS = 5 * MIN, STALE_MS = 30 * DAY, ATT_BEFORE_MS = 2 * DAY, ATT_AFTER_MS = 10 * MIN;
export var FE_RANK = { lock: 1, live: 2, nolock: 3, att: 4 };

var _B64K = /^[A-Za-z0-9+/=]{80,100}$/, _SIG = /^[A-Za-z0-9+/=]{40,200}$/, _HEX = /^[0-9a-f]{32}$/;
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _isNx(nx) { return /^nx[0-9a-z]{8}$/.test(nx || ''); }
function _subtle() { return (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) || (globalThis.crypto && globalThis.crypto.subtle); }
function _utf8(s) { return new TextEncoder().encode(s); }
function _unb64(b) { var s = atob(b), o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i); return o; }
function _hexRand(n) { var b = (window.crypto || globalThis.crypto).getRandomValues(new Uint8Array(n)); return Array.prototype.map.call(b, function(x) { return ('0' + x.toString(16)).slice(-2); }).join(''); }
function _int(x) { return typeof x === 'number' && isFinite(x) && Math.floor(x) === x; }
function _plugin() { return (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _ev(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }

// ---------- el interruptor ----------
function _devBuild() { var b = typeof window !== 'undefined' ? window.NEXO_BUILD : ''; return !/^\d+$/.test(String(b || '')); }
export function feEnabled() {
  if (FE_ON_DEFAULT) return true;
  if (!_devBuild()) return false;
  if (typeof window !== 'undefined' && window.NEXO_FENIX_ENTORNO === true) return true;
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(DEV_KEY) === '1'; } catch (e) { return false; }
}
// Solo en compilaciones de desarrollo (sin número de build): en una APK publicada no hace nada
export function feSetDev(on) {
  if (!_devBuild()) return false;
  try { if (on) localStorage.setItem(DEV_KEY, '1'); else localStorage.removeItem(DEV_KEY); } catch (e) {}
  return feEnabled();
}

// ---------- textos firmados ----------
function _attBody(nx, ep, n, oldIk, nwIk, nwSk, g, ts, ev) { return ['NEXO-FE-ATT', 1, nx, ep, n, oldIk, nwIk, nwSk, g, ts, (ev || []).join(',')].join('|'); }
function _rosBody(ros) { return ['NEXO-FE-ROS', 1, ros.nx, ros.old, ros.ts, (ros.g || []).map(function(x) { return x[0] + ':' + x[1]; }).join(',')].join('|'); }
function _recBody(r) {
  return ['NEXO-FE-REC', 1, r.nx, r.ep, r.ts, r.n, r.old.ik, r.old.sk, r.nw.ik, r.nw.sk, r.t,
    (r.att || []).map(function(a) { return a.g + ':' + a.ts + ':' + a.sig; }).join(','), (r.ros && r.ros.sig) || ''].join('|');
}
function _vetoBody(v) { return ['NEXO-FE-VETO', 1, v.nx, v.ep, v.old, v.ts, v.vn, v.au].join('|'); }

export async function feVerify(skB64, sigB64, text) {
  try {
    if (!_B64K.test(skB64 || '') || !_SIG.test(sigB64 || '')) return false;
    var k = await _subtle().importKey('raw', _unb64(skB64), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await _subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, k, _unb64(sigB64), _utf8(text));
  } catch (e) { return false; }
}

// sign: async (texto) → firma base64 (la llave de firma de quien firma)
export async function feAttest(sign, f) {
  var ev = (f.ev || []).filter(function(x) { return /^[a-z]{1,8}$/.test(x); }).slice(0, 8);
  var sig = await sign(_attBody(f.nx, f.ep, f.n, f.oldIk, f.nwIk, f.nwSk, f.g, f.ts, ev));
  return sig ? { g: f.g, ep: f.ep, old: f.oldIk, n: f.n, ts: f.ts, ev: ev, sig: sig } : null;
}
export async function feRoster(sign, nx, oldIk, list, ts) {
  var ros = { nx: nx, old: oldIk, ts: ts, g: (list || []).filter(function(x) { return _isNx(x[0]) && _B64K.test(x[1] || ''); }).slice(0, 30) };
  ros.sig = await sign(_rosBody(ros));
  return ros.sig ? ros : null;
}
export async function feBuildRecord(sign, f) {
  var r = { v: 1, k: 'fs', nx: f.nx, ep: f.ep, ts: f.ts, n: f.n, old: { ik: f.old.ik, sk: f.old.sk }, nw: { ik: f.nw.ik, sk: f.nw.sk }, t: f.t,
    att: (f.att || []).slice(0, 20).map(function(a) { return { g: a.g, ts: a.ts, ev: a.ev || [], sig: a.sig }; }) };
  if (f.ros) r.ros = f.ros;
  r.sig = await sign(_recBody(r));
  return r.sig ? r : null;
}
export async function feBuildVeto(sign, f) {
  var v = { v: 1, k: 'fv', nx: f.nx, ep: f.ep, old: f.old, ts: f.ts, vn: f.vn || _hexRand(16), au: f.au === 'lock' ? 'lock' : 'none' };
  v.sig = await sign(_vetoBody(v));
  return v.sig ? v : null;
}

function _recShape(r) {
  return !!(r && r.v === 1 && r.k === 'fs' && _isNx(r.nx) && _int(r.ep) && r.ep >= 1 && r.ep < 1e6 && _int(r.ts) && _HEX.test(r.n || '') &&
    r.old && _B64K.test(r.old.ik || '') && _B64K.test(r.old.sk || '') && r.nw && _B64K.test(r.nw.ik || '') && _B64K.test(r.nw.sk || '') &&
    _int(r.t) && r.t >= 1 && r.t <= 20 && Array.isArray(r.att) && r.att.length <= 20 && _SIG.test(r.sig || ''));
}
function _vetoShape(v) {
  return !!(v && v.v === 1 && v.k === 'fv' && _isNx(v.nx) && _int(v.ep) && v.ep >= 1 && _int(v.ts) && _B64K.test(v.old || '') &&
    _HEX.test(v.vn || '') && (v.au === 'lock' || v.au === 'none') && _SIG.test(v.sig || ''));
}
export function feVetoRank(v) { return v.au === 'lock' ? FE_RANK.lock : FE_RANK.nolock; }

// ¿Aceptar este registro? c = el contacto (su llave actual y su estado Fénix Entorno, c.fe); view = lo que este teléfono sabe:
// { now, minT, oldSk (llave de firma que YO tengo para la llave actual del contacto), keyOf(g) (la de firma de un guardián que
// yo conozco, o null) }. → { ok, why, valid, unknown, bad, need, rank }
export async function feCheckRecord(r, c, view) {
  var out = { ok: false, why: '', valid: 0, unknown: 0, bad: 0, need: 0, rank: FE_RANK.att };
  if (!_recShape(r)) { out.why = 'shape'; return out; }
  var nx = _nid(c && (c.nexoId || c.deviceUUID)), fe = (c && c.fe) || {}, cur = fe.ep || 0, now = view.now;
  if (!c || nx !== r.nx) { out.why = 'not_contact'; return out; }
  if (!c.publicKey) { out.why = 'no_key'; return out; }
  if ((fe.seen || []).indexOf(r.n) >= 0) { out.why = fe.st === 'ok' && fe.n === r.n ? 'dup' : 'replay'; return out; }
  if (r.ep <= cur) { out.why = 'old_epoch'; return out; }
  if (r.ep > cur + 1) { out.why = 'epoch_gap'; return out; }
  if (r.ts > now + FUTURE_MS) { out.why = 'future'; return out; }
  if (now - r.ts > STALE_MS) { out.why = 'stale'; return out; }
  if (r.old.ik !== c.publicKey) { out.why = 'old_key_mismatch'; return out; }
  if (!view.oldSk) { out.why = 'old_unknown'; return out; }
  if (r.old.sk !== view.oldSk) { out.why = 'old_key_mismatch'; return out; }
  if (r.nw.ik === r.old.ik || r.nw.sk === r.old.sk) { out.why = 'same_key'; return out; }
  if (!(await feVerify(r.nw.sk, r.sig, _recBody(r)))) { out.why = 'bad_sig'; return out; }
  // Guardianes que puedo comprobar: los míos y los de la lista firmada por la llave vieja (anterior al registro)
  var ros = {};
  if (r.ros && r.ros.nx === r.nx && r.ros.old === r.old.ik && _int(r.ros.ts) && r.ros.ts <= r.ts + FUTURE_MS && Array.isArray(r.ros.g) &&
      await feVerify(view.oldSk, r.ros.sig, _rosBody(r.ros))) r.ros.g.forEach(function(x) { if (_isNx(x[0])) ros[x[0]] = x[1]; });
  var seenG = {}, strong = 0;
  for (var i = 0; i < r.att.length; i++) {
    var a = r.att[i] || {}, g = _nid(a.g);
    if (!_isNx(g) || g === r.nx || seenG[g] || !_int(a.ts) || !Array.isArray(a.ev)) { out.bad++; continue; }
    seenG[g] = 1;
    if (a.ts < r.ts - ATT_BEFORE_MS || a.ts > r.ts + ATT_AFTER_MS) { out.bad++; continue; }
    var sk = view.keyOf(g) || ros[g];
    if (!sk) { out.unknown++; continue; }
    if (!(await feVerify(sk, a.sig, _attBody(r.nx, r.ep, r.n, r.old.ik, r.nw.ik, r.nw.sk, g, a.ts, a.ev)))) { out.bad++; continue; }
    out.valid++;
    if (a.ev.indexOf('rv') >= 0 && a.ev.indexOf('fv') >= 0) strong++; // retrato y firma vivos (fases siguientes)
  }
  out.need = Math.max(view.minT || 1, r.t);
  if (out.valid < out.need) { out.why = 'too_few'; return out; }
  out.rank = strong >= out.need ? FE_RANK.live : FE_RANK.att;
  var vt = fe.vt && fe.vt[r.ep];
  if (vt && vt.ts >= r.ts && vt.rk <= out.rank) { out.why = 'vetoed'; return out; }
  out.ok = true; out.why = 'ok';
  return out;
}

// Aplica un registro aceptado al contacto. info: { prevIk, prevSk, now, rank }
export function feApplyRecord(c, r, info) {
  var fe = c.fe || { ep: 0 };
  fe.seen = (fe.seen || []).concat(r.n).slice(-20);
  fe.ep = r.ep; fe.n = r.n; fe.st = 'ok'; fe.at = info.now; fe.rts = r.ts; fe.rk = info.rank || FE_RANK.att;
  fe.prevIk = info.prevIk; fe.prevSk = info.prevSk; fe.rec = r;
  c.fe = fe;
  c.publicKey = r.nw.ik;
  if (c.pendingKey === r.nw.ik) delete c.pendingKey;
  delete c.verified; delete c.pkHearsay; delete c.feConflict; delete c.feWarn;
  c.recoveredAt = info.now;
  return c;
}

// ¿Vale este veto? → { ok, why, mode: 'rollback' (deshacer la sucesión aceptada) | 'store' (guardar: rechaza el registro de esa
// época que llegue) | 'warn' (bueno pero más débil que la prueba del registro aceptado: solo aviso) }
export async function feCheckVeto(v, c, view) {
  var out = { ok: false, why: '', mode: '' };
  if (!_vetoShape(v)) { out.why = 'shape'; return out; }
  var nx = _nid(c && (c.nexoId || c.deviceUUID)), fe = (c && c.fe) || {};
  if (!c || nx !== v.nx) { out.why = 'not_contact'; return out; }
  if (v.ts > view.now + FUTURE_MS) { out.why = 'future'; return out; }
  if (view.now - v.ts > STALE_MS) { out.why = 'stale'; return out; }
  var sk = null;
  if (fe.st === 'ok' && v.ep === fe.ep) {
    if (v.old !== fe.prevIk) { out.why = 'old_key_mismatch'; return out; }
    sk = fe.prevSk;
    out.mode = (feVetoRank(v) <= (fe.rk || FE_RANK.att) && v.ts >= (fe.rts || 0)) ? 'rollback' : 'warn';
  } else if (v.ep === (fe.ep || 0) + 1 && v.old === c.publicKey) {
    sk = view.oldSk; out.mode = 'store';
  } else { out.why = 'no_match'; return out; }
  if (!sk || !(await feVerify(sk, v.sig, _vetoBody(v)))) { out.why = 'bad_sig'; out.mode = ''; return out; }
  out.ok = true; out.why = 'ok';
  return out;
}

export function feApplyVeto(c, v, mode, now) {
  var fe = c.fe = c.fe || { ep: 0 };
  fe.vt = fe.vt || {};
  var old = fe.vt[v.ep], rk = feVetoRank(v);
  if (!old || v.ts > old.ts || rk < old.rk) fe.vt[v.ep] = { ts: Math.max(v.ts, (old && old.ts) || 0), rk: Math.min(rk, (old && old.rk) || 9) };
  if (mode === 'rollback') {
    var nw = c.publicKey;
    c.publicKey = fe.prevIk;
    if (c.pendingKey === fe.prevIk) delete c.pendingKey;
    c.rejectedKey = nw;
    delete c.verified; delete c.recoveredAt; delete c.feConflict;
    fe.st = 'vetoed'; fe.ep = v.ep - 1; fe.vetoedAt = now;
    c.feWarn = now;
  } else if (mode === 'warn') c.feWarn = now;
  return c;
}

// La llave VIEJA vuelve a hablar después de una sucesión aceptada → conflicto visible (true si se marcó ahora)
export function feNoteOldKey(c, pk, now) {
  if (!c || !c.fe || c.fe.st !== 'ok' || !pk || pk !== c.fe.prevIk || pk === c.publicKey || c.feConflict) return false;
  c.feConflict = now;
  return true;
}

// ---------- en la app ----------
export class FenixEntorno {
  constructor(ble, fx) {
    this.ble = ble; this.fx = fx;
    this.mine = null;      // teléfono nuevo: mi registro de sucesión (se manda a cada contacto)
    this.out = [];         // teléfono viejo: mis vetos (se mandan a cada contacto)
    this.claims = {};      // teléfono viejo: registros que reclaman mi cuenta (n → registro)
    this.sent = {};        // (sesión) nexoId → qué se le mandó ya
    this.gate = null;      // async (título) → { need, ok }: el desbloqueo de NEXO (app_lock.js)
    this.signer = null;    // pruebas: { ik, sk, sign }
    this.keys = null;      // pruebas: nexoId → paquete público { ik, sk }
    this._win = [];
    this.ready = null;
    if (_devBuild() && typeof window !== 'undefined') window.nexoDevFenixEntorno = feSetDev;
  }
  on() { return feEnabled(); }
  me() { return _nid(this.ble && this.ble.localNexoId); }
  _myIk() { return this.signer ? this.signer.ik : e2eMyPublicKey(); }
  _mySk() { return this.signer ? this.signer.sk : ratchetMySigningKey(); }
  _sign(text) { return this.signer ? this.signer.sign(text) : ratchetSignFe(text); }
  _bundle(nx) { return this.keys ? this.keys(nx) : ratchetPeerBundle(nx); }
  _contacts() { return (this.ble && typeof this.ble.getBLEContacts === 'function') ? (this.ble.getBLEContacts() || []) : []; }
  _find(list, nx) { return list.find(function(x) { return _nid(x.nexoId || x.deviceUUID) === nx; }); }
  _saveContacts(list) { if (typeof window !== 'undefined' && typeof window.vaultSaveContacts === 'function') window.vaultSaveContacts(list); }
  init() {
    var self = this;
    if (self.ready) return self.ready;
    var pl = _plugin();
    self.ready = (pl && typeof pl.loadFromFile === 'function' ? pl.loadFromFile({ filename: FE_FILE }).catch(function() { return null; }) : Promise.resolve(null)).then(function(r) {
      try { var d = r && r.exists && r.content ? JSON.parse(r.content) : null; if (d) { self.mine = d.mine || null; self.out = d.out || []; self.claims = d.claims || {}; } } catch (e) {}
    });
    return self.ready;
  }
  _save() {
    var pl = _plugin();
    if (!pl || typeof pl.saveToFile !== 'function') return Promise.resolve();
    return pl.saveToFile({ filename: FE_FILE, content: JSON.stringify({ v: 1, mine: this.mine, out: this.out, claims: this.claims }) }).catch(function() {});
  }
  _view(c, list) {
    var self = this, me = self.me(), nx = _nid(c.nexoId || c.deviceUUID), b = self._bundle(nx);
    var oldSk = (b && b.ik === c.publicKey) ? b.sk : (c.fe && c.fe.prevIk === c.publicKey ? c.fe.prevSk : null);
    return { now: Date.now(), minT: Math.max(1, (self.fx && self.fx.cfg && self.fx.cfg.t) || 6), oldSk: oldSk || null,
      keyOf: function(g) {
        if (g === me) return self._mySk();
        var gc = self._find(list, g), gb = gc && gc.publicKey && !gc.pendingKey && !gc.pkHearsay ? self._bundle(g) : null;
        return gb && gb.ik === gc.publicKey ? gb.sk : null;
      } };
  }
  _send(dev, obj) {
    if (!dev || !this.ble || typeof this.ble._sendMessageNative !== 'function') return Promise.resolve();
    return Promise.resolve(this.ble._sendMessageNative(dev, JSON.stringify(Object.assign({ v: 1, from: this.me() }, obj)), null)).catch(function() {});
  }

  // --- teléfono nuevo: lo que va en la petición de recuperación ('fq') ---
  askExtra(rec) {
    if (!this.on() || !rec) return null;
    var sk = this._mySk();
    if (!sk) { console.warn('[FENIX-E] Sin llave de firma todavía: la petición sale sin Fénix Entorno'); return null; }
    rec.fe = rec.fe || { n: _hexRand(16) };
    return { fe: { n: rec.fe.n, nk: sk } };
  }
  // --- guardián: lo que trae la petición ---
  reqExtra(p) {
    if (!this.on() || !p || !p.fe || !_HEX.test(p.fe.n || '') || !_B64K.test(p.fe.nk || '')) return null;
    return { n: p.fe.n, nk: p.fe.nk };
  }
  // --- guardián: atestación para el teléfono nuevo (va con su fragmento) ---
  async attest(owner, req) {
    if (!this.on() || !req || !req.fe || !_B64K.test(req.pk || '')) return null;
    var c = this._find(this._contacts(), _nid(owner));
    if (!c || !c.publicKey || c.publicKey === req.pk) return null;
    var ep = ((c.fe && c.fe.ep) || 0) + 1;
    var a = await feAttest(this._sign.bind(this), { nx: _nid(owner), ep: ep, n: req.fe.n, oldIk: c.publicKey, nwIk: req.pk, nwSk: req.fe.nk, g: this.me(), ts: Date.now(), ev: ['sh'] });
    if (a) console.log('[FENIX-E] Atestación para la cuenta ' + _nid(owner) + ' (época ' + ep + ')');
    return a;
  }
  // --- teléfono viejo, al respaldar: la copia no lleva las llaves privadas y sí la lista de guardianes firmada ---
  async decorateAccount(acc) {
    if (!this.on() || !acc) return;
    var ik = null;
    try { var id = JSON.parse(acc.identity || 'null'); ik = id && id.pub; if (ik) acc.identity = JSON.stringify({ v: 1, pub: ik }); } catch (e) {}
    if (acc.ratchet) acc.ratchet = { ik: acc.ratchet.ik, sign: { pub: acc.ratchet.sign && acc.ratchet.sign.pub } };
    var self = this, list = self._contacts();
    var gs = Object.keys(acc.nodes || {}).map(function(g) {
      var gc = self._find(list, g), b = gc && gc.publicKey ? self._bundle(g) : null;
      return b && b.ik === gc.publicKey ? [g, b.sk] : null;
    }).filter(Boolean);
    if (ik) acc.ros = await feRoster(self._sign.bind(self), self.me(), ik, gs, Date.now());
  }
  // --- teléfono nuevo, al recuperar: me quedo con MI llave y preparo el registro. true = no escribir la identidad vieja ---
  async onRestore(acc, pieces, rec) {
    if (!this.on() || !acc) return false;
    var oldIk = null, oldSk = acc.ratchet && acc.ratchet.sign && acc.ratchet.sign.pub;
    try { oldIk = JSON.parse(acc.identity || 'null').pub; } catch (e) {}
    var nwIk = this._myIk(), nwSk = this._mySk(), n = rec && rec.fe && rec.fe.n;
    if (!oldIk || !oldSk || !nwIk || !nwSk || !n) { console.warn('[FENIX-E] Recuperación sin datos para la sucesión: se usa la llave de la copia'); return false; }
    // Las atestaciones de la misma época y llave vieja (la mayoría)
    var groups = {};
    (pieces || []).forEach(function(p) {
      var a = p && p.fa;
      if (!a || a.n !== n || a.old !== oldIk || !_int(a.ep) || !_isNx(_nid(a.g))) return;
      (groups[a.ep] = groups[a.ep] || []).push(a);
    });
    var best = Object.keys(groups).sort(function(x, y) { return groups[y].length - groups[x].length; })[0];
    var ep = best ? Number(best) : 1, att = best ? groups[best] : [];
    this.mine = await feBuildRecord(this._sign.bind(this), { nx: _nid(acc.nexoId), ep: ep, ts: Date.now(), n: n, old: { ik: oldIk, sk: oldSk },
      nw: { ik: nwIk, sk: nwSk }, t: acc.t || 1, att: att, ros: acc.ros || null });
    await this._save();
    console.log('[FENIX-E] Cuenta recuperada con llave NUEVA; registro de sucesión listo (época ' + ep + ', ' + att.length + ' atestaciones)');
    return !!this.mine;
  }
  // --- un contacto conectado: le mando lo pendiente (registro y vetos), una vez por sesión ---
  onPeer(nx, dev) {
    if (!this.on() || !dev) return;
    var s = this.sent[nx] = this.sent[nx] || {}, self = this;
    if (self.mine && !s.fs) { s.fs = 1; self._send(dev, { type: 'fs', r: self.mine }); }
    var now = Date.now();
    self.out = self.out.filter(function(v) { return now - v.ts < STALE_MS; });
    self.out.forEach(function(v) { if (!s['fv' + v.vn]) { s['fv' + v.vn] = 1; self._send(dev, { type: 'fv', r: v }); } });
  }

  // --- lo que llega ('fs' / 'fv') ---
  handle(p, dev) {
    var self = this;
    if (!self.on()) { console.log('[FENIX-E] ' + (p && p.type) + ' ignorado: Fénix Entorno desactivado'); return true; }
    if (!_recWindowOk(self._win, Date.now(), 30, 3600000)) { console.warn('[FENIX-E] Demasiados registros: ignoro'); return true; }
    self.init().then(function() { return p.type === 'fs' ? self.onRecord(p.r, dev) : self.onVeto(p.r, dev); })
      .catch(function(e) { console.warn('[FENIX-E] ' + (e && e.message)); });
    return true;
  }
  async onRecord(r, dev) {
    if (!this.on() || !r || typeof r !== 'object') return 'off';
    var nx = _nid(r.nx), me = this.me();
    if (nx && nx === me) {
      // Alguien reclama MI cuenta (yo soy el teléfono viejo): se le pregunta al usuario si quiere vetarlo
      if (!_recShape(r) || !r.old || r.old.ik !== this._myIk() || this.claims[r.n]) return 'ignored';
      this.claims[r.n] = r;
      await this._save();
      console.warn('[FENIX-E] Otro teléfono reclama mi cuenta (época ' + r.ep + ')');
      _ev('nexo:fenix:claim', { n: r.n, ep: r.ep, ts: r.ts });
      this._askClaim(r.n);
      return 'claim';
    }
    var list = this._contacts(), c = this._find(list, nx);
    if (!c) return 'not_contact';
    var view = this._view(c, list), res = await feCheckRecord(r, c, view);
    console.log('[FENIX-E] Registro de sucesión de ' + nx + ' (época ' + r.ep + '): ' + res.why + (res.why === 'too_few' ? ' (' + res.valid + ' de ' + res.need + ', ' + res.unknown + ' desconocidos, ' + res.bad + ' malos)' : ''));
    if (!res.ok) return res.why;
    var pb = c.pendingBundle;
    delete c.pendingBundle;
    feApplyRecord(c, r, { prevIk: c.publicKey, prevSk: view.oldSk, now: view.now, rank: res.rank });
    this._saveContacts(list);
    var ble = this.ble;
    if (pb && pb.ik === r.nw.ik && typeof ble._notePeerBundle === 'function') ble._notePeerBundle(nx, pb);
    var held = (ble._held || []).filter(function(h) { return h.nx === nx; });
    if (held.length) { ble._held = ble._held.filter(function(h) { return h.nx !== nx; }); held.forEach(function(h) { try { h.release(); } catch (e) {} }); }
    _ev('nexo:e2e:key', { nexoId: nx, changed: false, accepted: true, recovered: true });
    if (typeof ble._resendPendingMessages === 'function') { try { ble._resendPendingMessages(nx); } catch (e) {} }
    return 'accepted';
  }
  async onVeto(v, dev) {
    if (!this.on() || !v || typeof v !== 'object') return 'off';
    var nx = _nid(v.nx);
    if (nx === this.me()) return 'ignored';
    var list = this._contacts(), c = this._find(list, nx);
    if (!c) return 'not_contact';
    var res = await feCheckVeto(v, c, this._view(c, list));
    console.log('[FENIX-E] Veto de ' + nx + ' (época ' + (v.ep | 0) + ', ' + (v.au === 'lock' ? 'con desbloqueo' : 'sin desbloqueo') + '): ' + res.why + (res.ok ? ' → ' + res.mode : ''));
    if (!res.ok) return res.why;
    var nw = c.publicKey;
    feApplyVeto(c, v, res.mode, Date.now());
    this._saveContacts(list);
    if (res.mode === 'rollback') {
      ratchetForget(nx, nw).catch(function() {});
      if (this.ble && this.ble._held) this.ble._held = this.ble._held.filter(function(h) { return h.nx !== nx; });
      _ev('nexo:e2e:key', { nexoId: nx, changed: false, rejected: true, vetoed: true });
    } else if (res.mode === 'warn') _ev('nexo:e2e:key', { nexoId: nx, changed: false, warn: true });
    return res.mode;
  }
  // --- un kx directo: si es la llave VIEJA tras una sucesión aceptada → conflicto, y le reenvío el registro (para que pueda vetar) ---
  onKx(nexoId, pk, dev) {
    if (!this.on()) return false;
    var nx = _nid(nexoId), list = this._contacts(), c = this._find(list, nx);
    if (!c || !c.fe || c.fe.st !== 'ok' || pk !== c.fe.prevIk) return false;
    if (feNoteOldKey(c, pk, Date.now())) {
      this._saveContacts(list);
      console.warn('[FENIX-E] La llave anterior de ' + nx + ' sigue hablando tras la sucesión: conflicto');
      _ev('nexo:e2e:key', { nexoId: nx, changed: false, conflict: true });
    }
    var s = this.sent[nx] = this.sent[nx] || {};
    if (c.fe.rec && dev && s.back !== dev) { s.back = dev; this._send(dev, { type: 'fs', r: c.fe.rec }); }
    return true;
  }
  // --- teléfono viejo: «no soy yo» ---
  _askClaim(n) {
    var self = this;
    if (typeof window === 'undefined' || typeof window.confirm !== 'function' || self._asking) return;
    self._asking = true;
    setTimeout(function() {
      var yes = false;
      try { yes = window.confirm(t('fe_claim_q', 'Otro teléfono está recuperando tu cuenta de NEXO. Si NO eres tú, toca Aceptar para impedirlo (se te pedirá tu desbloqueo de NEXO si lo tienes).')); } catch (e) {}
      self._asking = false;
      if (yes) self.veto(n);
    }, 0);
  }
  async veto(n) {
    if (!this.on()) return 'off';
    var r = this.claims[n];
    if (!r) return 'no_claim';
    // El método de desbloqueo que el usuario eligió (si tiene uno) se exige para vetar. Sin ninguno: veto «sin desbloqueo»
    // (rango 3; decisión abierta del dueño)
    var g = this.gate ? await this.gate(t('fe_veto_auth', 'Confirma que no eres tú')) : { need: false, ok: false };
    if (g && g.need && !g.ok) { console.warn('[FENIX-E] Veto cancelado: no se confirmó el desbloqueo'); return 'auth_failed'; }
    var v = await feBuildVeto(this._sign.bind(this), { nx: this.me(), ep: r.ep, old: this._myIk(), ts: Date.now(), au: g && g.need ? 'lock' : 'none' });
    if (!v) return 'no_key';
    this.out = this.out.concat(v).slice(-5);
    await this._save();
    var self = this;
    this._contacts().forEach(function(c) {
      var nx = _nid(c.nexoId || c.deviceUUID), dev = self.fx && typeof self.fx._readyDevice === 'function' ? self.fx._readyDevice(nx) : null;
      if (dev) { (self.sent[nx] = self.sent[nx] || {})['fv' + v.vn] = 1; self._send(dev, { type: 'fv', r: v }); }
    });
    console.warn('[FENIX-E] Veto enviado (' + (v.au === 'lock' ? 'con desbloqueo' : 'sin desbloqueo') + ')');
    return 'sent:' + v.au;
  }
}

export function createFenixEntorno(ble, fx) { return new FenixEntorno(ble, fx); }
