/**
 * group_admin.js (22-11, COLA 4b «Grupos: administración», G2–G5 y G9) — La parte de Groups (groups.js) que lleva el ESTADO firmado
 * del grupo (group_state.js): hacer un cambio (firmarlo, guardarlo y mandarlo), recibir los de los demás (validarlos y avisar en el
 * chat), ponerse al día con quien va adelantado o atrasado y la copia cifrada en el buzón de archivos de los relés.
 * Se mezcla en Groups.prototype (groups.js). Los permisos se hacen cumplir AL RECIBIR: un cambio o un mensaje de quien no tiene
 * permiso se descarta (registro «[GROUP] … descartado»).
 * Cómo viaja: en el sobre de grupo (nexo_grp) de siempre, con campos nuevos:
 *   s  los últimos estados firmados (hasta GS_CHAIN_SEND), en un cambio y al ponerse al día
 *   sv versión del estado que tiene quien manda (en todos los sobres de un grupo con estado)
 *   sp puntero a la copia cifrada del estado en el buzón de archivos (hasta GS_LOG_KEEP estados, 7 días)
 *   q  1 = «mándame tu estado» (quien manda vio que va atrasado)
 *   pi la foto del grupo (data URL), solo cuando el cambio la trae (su huella va firmada en el estado: ph)
 * El texto (c) de un cambio lleva gs:1: el que recibe NO lo muestra; escribe él mismo el aviso con lo que de verdad cambió.
 */
import { gsClean, gsVerify, gsImplicit, gsCan, gsStepError, gsGenesisError, gsWins, gsNext, gsDiff, gsSigned, gsSigToB64, gsIsBoss, GS_LOG_KEEP, GS_CHAIN_SEND, GS_MAX_MEMBERS } from './group_state.js';
import { e2eSign, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { _getBLEContacts } from './ble_helpers.js';
import { stageBlob, fetchBlob, validatePointer, _bytesToB64, _b64ToBytes } from '../net/blob_mailbox.js';
import { setChatWallpaperFor } from './wallpaper.js';
import { t } from './i18n.js';

var SYNC_EVERY_MS = 60000;      // pedir o mandar el estado a un mismo miembro, como mucho una vez por minuto
var PH_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var PH_MAX = 60000;

function _nid(x) { return (x || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
function _toast(s) { try { if (window.NEXO_toast) window.NEXO_toast(s); } catch (e) {} }
function _inner(c) { try { var o = JSON.parse(c); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
// Huella corta de la foto del grupo (la que va firmada en el estado)
export function groupPhotoHash(img) {
  var h1 = 0x811c9dc5, h2 = 0x01000193, s = String(img || '');
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 + c, 2246822519) >>> 0; }
  return s ? ('p' + s.length.toString(36) + h1.toString(36) + h2.toString(36)) : '';
}

export var groupAdminMethods = {
  // Estado vigente (el firmado o, en un grupo viejo, el implícito)
  state(gid) { var g = this.get(gid); return g ? (g.s || gsImplicit(g)) : null; },
  can(gid, what, target, who) { var s = this.state(gid); return !!s && gsCan(s, who || this._me(), what, target); },
  canWrite(gid) { var g = this.get(gid); return !!g && !g.kicked && !g.left && this.can(gid, 'write'); },
  isAdminOf(gid, nx) { var s = this.state(gid); return !!s && s.ad.indexOf(_nid(nx)) >= 0; },
  creatorOf(gid) { var s = this.state(gid); return s ? (s.cr || null) : null; },
  blockedOf(gid) { var s = this.state(gid); return s ? s.bl.slice() : []; },

  // Clave pública de un miembro: la mía, la de su contacto o (solo al ENTRAR a un grupo: cards) la de una tarjeta de ESTE sobre.
  // En un grupo que ya conozco no vale una tarjeta del mismo sobre: si no, un miembro colaría una clave falsa de otro y firmaría por él.
  _keyOf(nx, cards) {
    nx = _nid(nx);
    if (nx === this._me()) return e2eMyPublicKey();
    var c = (_getBLEContacts() || []).find(function(x) { return _nid(x.nexoId || x.deviceUUID) === nx; });
    if (c && c.publicKey && !c.pendingKey) return c.publicKey;
    return (cards && this._cardKeys && this._cardKeys[nx]) || null;
  },
  _verify(s, cards) { var k = this._keyOf(s.by, cards); var ok = !!k && gsVerify(s, k); if (!ok) console.warn('[GROUP] Estado v' + s.v + ' de ' + s.g + ' firmado por ' + s.by + ': firma ' + (k ? 'no válida' : 'sin clave para comprobarla')); return ok; },
  _logAt(g, v) { return (g.sl || []).find(function(x) { return x.v === v; }) || (v === 0 && !g.sl ? gsImplicit(g) : null); },
  _logPut(g, s) {
    g.sl = (g.sl || []).filter(function(x) { return x.v < s.v; });
    g.sl.push(s);
    if (g.sl.length > GS_LOG_KEEP) g.sl = g.sl.slice(g.sl.length - GS_LOG_KEEP);
    g.s = s;
  },
  _chain(g) { var l = g.sl || (g.s ? [g.s] : []); return l.slice(Math.max(0, l.length - GS_CHAIN_SEND)); },

  // ---- hacer un cambio ----
  // ch: campos nuevos del estado (m, ad, bl, n, ph, md, ow, oa). opts: { notice: texto, to: a quién además, pi: foto, cards }
  // Devuelve una promesa con el estado nuevo (o lanza si no está permitido).
  change(gid, ch, opts) {
    var self = this, g = this.get(gid), me = this._me();
    opts = opts || {};
    if (!g || g.left || g.kicked) return Promise.reject(new Error(t('grp_err_not_member', 'Ya no estás en este grupo')));
    var prev = this.state(gid), next = gsNext(prev, me, ch);
    var err = gsStepError(prev, next);
    if (err) { console.warn('[GROUP] Cambio no permitido en ' + gid + ': ' + err); return Promise.reject(new Error(t('grp_err_not_allowed', 'No tienes permiso para hacer eso en este grupo'))); }
    if (next.m.length > GS_MAX_MEMBERS) return Promise.reject(new Error(t('grp_max_a', 'Máximo ') + GS_MAX_MEMBERS + t('grp_max_people', ' personas')));
    return this._sign(next).then(function(sn) {
      if (!g.sl && prev.v === 0 && g.s === undefined) g.sl = [];
      self._logPut(g, sn);
      self._applied(g, [{ prev: prev, next: sn }], true);
      var to = prev.m.concat(sn.m).filter(function(x, i, a) { return x !== me && a.indexOf(x) === i; });
      var wire = JSON.stringify(Object.assign({ type: 'nexo_txt', t: opts.notice || '👥', gs: 1 }, opts.gl ? { gl: 1 } : {}));
      var extra = { s: self._chain(g) };
      if (opts.pi) extra.pi = opts.pi;
      if (g.sp) extra.sp = g.sp;
      if (typeof window.NEXO_sendGroupText === 'function' && !opts.quiet) window.NEXO_sendGroupText(gid, wire, opts.notice || '👥', null, opts.cards || null, { to: to, extra: extra });
      else self.sendText(gid, wire, null, null, to, opts.cards || null, extra);
      self._stageCopy(g);
      console.log('[GROUP] Cambio v' + sn.v + ' en ' + gid + ' (' + JSON.stringify(gsDiff(prev, sn)).substring(0, 160) + ')');
      return sn;
    });
  },
  _sign(s) {
    return e2eSign(gsSigned(s)).then(function(sig) {
      if (!sig || sig.length !== 64) throw new Error(t('grp_err_sign', 'No se pudo firmar el cambio'));
      s.sg = gsSigToB64(sig);
      return s;
    });
  },
  // Estado de creación (v1) de un grupo nuevo: lo firma el creador; devuelve los estados para el primer sobre
  signGenesis(gid, md, ow) {
    var self = this, g = this.get(gid), me = this._me();
    if (!g || g.s) return Promise.resolve(g && g.s ? this._chain(g) : null);
    var s = { g: g.id, v: 1, cr: me, ad: [me], md: md === 'c' ? 'c' : 'o', ow: ow ? 1 : 0, oa: 0, m: g.members.slice(), bl: [], n: g.name, ph: '', by: me, t: Date.now(), sg: '' };
    return this._sign(s).then(function(sn) { g.sl = []; self._logPut(g, sn); self._save(); self._stageCopy(g); return self._chain(g); }).catch(function(e) { console.warn('[GROUP] Sin estado firmado para ' + gid + ': ' + (e && e.message)); return null; });
  },

  // Atajos (los usa el panel «Ajustes del grupo»)
  addMembers(gid, list, cards) {
    var s = this.state(gid), add = (list || []).map(_nid).filter(function(x) { return s.m.indexOf(x) < 0; });
    if (!add.length) return Promise.resolve(s);
    var bl = s.bl.filter(function(x) { return add.indexOf(x) < 0; });   // volver a agregar a un bloqueado = desbloquearlo (solo quien puede)
    return this.change(gid, { m: s.m.concat(add), bl: bl }, { notice: '👥 ' + t('grp_n_added', 'Nuevo en el grupo: ') + add.map(this.memberName, this).join(', '), cards: cards });
  },
  kick(gid, nx, block) {
    var s = this.state(gid); nx = _nid(nx);
    var ch = { m: s.m.filter(function(x) { return x !== nx; }), ad: s.ad.filter(function(x) { return x !== nx; }) };
    if (block && s.bl.indexOf(nx) < 0) ch.bl = s.bl.concat([nx]);
    return this.change(gid, ch, { notice: '👥 ' + (block ? t('grp_n_kicked_bl', 'Expulsado y bloqueado en este grupo: ') : t('grp_n_kicked', 'Expulsado del grupo: ')) + this.memberName(nx) });
  },
  unblock(gid, nx) {
    var s = this.state(gid); nx = _nid(nx);
    return this.change(gid, { bl: s.bl.filter(function(x) { return x !== nx; }) }, { notice: '👥 ' + t('grp_n_unblocked', 'Desbloqueado en este grupo: ') + this.memberName(nx) });
  },
  setAdmins(gid, list) {
    var s = this.state(gid), want = (list || []).map(_nid).filter(function(x) { return s.m.indexOf(x) >= 0; });
    if (s.cr && want.indexOf(s.cr) < 0) want.unshift(s.cr);
    var ad = s.ad.filter(function(x) { return want.indexOf(x) >= 0; }).concat(want.filter(function(x) { return s.ad.indexOf(x) < 0; }));
    var plus = ad.filter(function(x) { return s.ad.indexOf(x) < 0; }), minus = s.ad.filter(function(x) { return ad.indexOf(x) < 0; });
    if (!plus.length && !minus.length) return Promise.resolve(s);
    var n = [];
    if (plus.length) n.push(t('grp_n_admin', 'Ahora es admin: ') + plus.map(this.memberName, this).join(', '));
    if (minus.length) n.push(t('grp_n_unadmin', 'Ya no es admin: ') + minus.map(this.memberName, this).join(', '));
    return this.change(gid, { ad: ad }, { notice: '👥 ' + n.join(' · ') });
  },
  setSettings(gid, ch) {
    var s = this.state(gid), o = {}, n = [];
    if (ch.md && ch.md !== s.md) { o.md = ch.md; n.push(ch.md === 'c' ? t('grp_n_mode_c', 'Modo Control') : t('grp_n_mode_o', 'Modo Colegas')); }
    if ('ow' in ch && (ch.ow ? 1 : 0) !== s.ow) { o.ow = ch.ow ? 1 : 0; n.push(o.ow ? t('grp_n_ow1', 'Solo los administradores escriben') : t('grp_n_ow0', 'Todos pueden escribir')); }
    if ('oa' in ch && (ch.oa ? 1 : 0) !== s.oa) { o.oa = ch.oa ? 1 : 0; n.push(o.oa ? t('grp_n_oa1', 'Solo los administradores agregan') : t('grp_n_oa0', 'Todos pueden agregar')); }
    if (!n.length) return Promise.resolve(s);
    return this.change(gid, o, { notice: '👥 ' + n.join(' · ') });
  },
  renameSigned(gid, name) {
    var nm = String(name || '').trim().substring(0, 60);
    if (!nm || nm === this.state(gid).n) return Promise.resolve(this.state(gid));
    return this.change(gid, { n: nm }, { notice: '👥 ' + t('grp_n_name', 'Nombre del grupo: ') + '«' + nm + '»' });
  },
  setPhoto(gid, img) {
    img = img || '';
    if (img && (!PH_RE.test(img) || img.length > PH_MAX)) return Promise.reject(new Error(t('grp_err_photo', 'Esa foto no sirve')));
    var self = this, ph = groupPhotoHash(img);
    return this.change(gid, { ph: ph }, { notice: '👥 ' + (img ? t('grp_n_photo', 'Foto del grupo nueva') : t('grp_n_photo0', 'Se quitó la foto del grupo')), pi: img || undefined }).then(function(s) { self._photoPut(gid, ph, img); return s; });
  },
  // Salir con estado firmado (si soy el creador, pasa al admin más antiguo; si no queda nadie, el grupo queda abierto)
  leaveSigned(gid) {
    var s = this.state(gid), me = this._me();
    var ad = s.ad.filter(function(x) { return x !== me; });
    var ch = { m: s.m.filter(function(x) { return x !== me; }), ad: ad, cr: s.cr === me ? (ad[0] || null) : s.cr };
    return this.change(gid, ch, { notice: t('grp_left_msg', '👋 Salió del grupo'), gl: 1 });
  },

  // ---- foto del grupo (G6): se guarda aparte, por su huella ----
  _photoPut(gid, ph, img) {
    this._photos = this._photos || {};
    this._photos[gid] = img ? { ph: ph, img: img } : null;
    var pl = _plugin();
    if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: 'nexo_grpav_' + gid + '.json', content: JSON.stringify({ ph: ph, img: img || '' }) }).catch(function() {});
    _emit('nexo:groups', { id: gid, photo: 1 });
  },
  photoOf(gid) {
    var g = this.get(gid), p = this._photos && this._photos[_nid(gid)];
    return g && g.s && g.s.ph && p && p.ph === g.s.ph ? p.img : null;
  },
  _photosLoad() {
    var self = this, pl = _plugin();
    if (!pl || typeof pl.loadFromFile !== 'function') return;
    this._photos = this._photos || {};
    Object.keys(this.list).forEach(function(gid) {
      var g = self.list[gid];
      if (!g.s || !g.s.ph) return;
      pl.loadFromFile({ filename: 'nexo_grpav_' + gid + '.json' }).then(function(r) {
        var o = r && r.exists && r.content ? JSON.parse(r.content) : null;
        if (o && o.ph && !self._photos[gid]) { self._photos[gid] = o; _emit('nexo:groups', { id: gid, photo: 1 }); }
      }).catch(function() {});
    });
  },

  // ---- recibir ----
  // Lo llama receive() (groups.js) ANTES de lo de siempre. Devuelve undefined para seguir con lo de siempre, o { ret } para terminar.
  _adminReceive(env, from, wireId) {
    var self = this, gid = _nid(env.g), g = this.list[gid], me = this._me(), inner = _inner(env.c);
    if (Array.isArray(env.k)) { this._cardKeys = {}; env.k.forEach(function(c) { var id = _nid(c && c.nexoId); if (/^nx[0-9a-z]{8}$/.test(id) && typeof c.publicKey === 'string') self._cardKeys[id] = c.publicKey; }); }
    try {
      if (Array.isArray(env.s) && env.s.length) {
        var res = this._applyChain(gid, env.s, from, env);
        g = this.list[gid];
        if (g && !g.left && res.applied.length) this._takeCards(g, env, from);
        if (res.gap) { this._askState(gid, from); if (env.sp) this._fetchCopy(gid, env.sp, env.s); }
        // Grupo viejo (sin estado): una salida que no se pudo validar sigue como antes (quita al que se va)
        if (!res.applied.length && inner && inner.gl && g && !g.s) return undefined;
        if (inner && inner.gs) return { ret: null };
      }
      if (env.q) { if (g && g.s && g.s.m.indexOf(from) >= 0) this._pushState(gid, from, true); return { ret: null }; }
      if (inner && inner.gs) return { ret: null };   // un aviso de cambio sin estado válido: no se muestra
      // G7: fondo del grupo compartido: solo de quien puede cambiar el grupo; se aplica aquí (local) y no se muestra como mensaje
      if (inner && inner.type === 'nexo_act' && inner.act === 'gwp') {
        if (g && !g.left && !g.kicked && gsCan(this.state(gid), from, 'edit') && typeof inner.img === 'string' && setChatWallpaperFor(gid, inner.img)) {
          console.log('[GROUP] Fondo del grupo ' + gid + ' compartido por ' + from);
          _toast('🎨 ' + this.memberName(from) + ' ' + t('grp_wp_got', 'compartió el fondo del grupo'));
        } else console.warn('[GROUP] Fondo del grupo ' + gid + ' de ' + from + ' descartado (sin permiso o no válido)');
        return { ret: null };
      }
      if (g && g.s && !g.left && !g.kicked) {
        if (g.s.m.indexOf(from) < 0) return undefined;   // lo de siempre lo descarta (no es miembro)
        this._syncCheck(g, env, from);
        if (!gsCan(g.s, from, 'write')) { console.warn('[GROUP] Mensaje de ' + from + ' en ' + gid + ' descartado: solo los administradores escriben'); return { ret: null }; }
      }
      return undefined;
    } finally { this._cardKeys = null; }
  },
  // Un grupo que se crea por un sobre de un grupo CON estado que aún no llegó: se marca y se pide el estado
  _adminCreated(g, env, from) { if (Number(env.sv) > 0) { g.pend = 1; this._askState(g.id, from); } },

  // Aplica los estados que llegan (en orden). Devuelve { applied: [{prev,next}], gap }
  _applyChain(gid, raw, from, env) {
    var self = this, me = this._me(), g = this.list[gid];
    var chain = raw.slice(0, GS_LOG_KEEP + GS_CHAIN_SEND).map(gsClean).filter(function(s) { return s && s.g === gid; }).sort(function(a, b) { return a.v - b.v; });
    var applied = [], gap = false;
    if (!chain.length) return { applied: applied, gap: false };
    // Entrar (invitación), volver a entrar o un grupo aún sin estado: vale el último, firmado por un miembro, con quien manda y conmigo dentro
    if (!g || g.pend || g.kicked || g.left) {
      var top = chain[chain.length - 1];
      var ok = top.m.indexOf(me) >= 0 && top.m.indexOf(from) >= 0 && top.m.indexOf(top.by) >= 0 && (top.v > 1 || !gsGenesisError(top)) && (!g || !g.s || top.v > g.s.v) && this._verify(top, true);
      if (!ok) { console.warn('[GROUP] Estado de ' + gid + ' (de ' + from + ') no sirve para entrar al grupo'); return { applied: applied, gap: false }; }
      if (g && g.left && !g.kicked) return { applied: applied, gap: false };   // salí yo: no vuelvo solo por un estado
      var prev = g && g.s ? g.s : null;
      if (!g) g = this.list[gid] = { id: gid, name: top.n, members: top.m.slice(), createdBy: top.cr || top.by, createdAt: Date.now(), lastMessageAt: 0, unreadCount: 0 };
      g.sl = []; this._logPut(g, top);
      g.pend = 0; g.kicked = false; g.left = false;
      applied.push({ prev: prev, next: top, join: true });
      console.log('[GROUP] Entro al grupo ' + gid + ' con el estado v' + top.v + ' (de ' + from + ')');
    } else {
      var cur = g.s || gsImplicit(g);
      chain.forEach(function(s) {
        if (s.v < cur.v) return;
        if (s.v === cur.v) {
          if (!g.s || s.sg === cur.sg) return;
          var base = self._logAt(g, s.v - 1);
          if (base && self._verify(s) && !gsStepError(base, s) && gsWins(s, cur, base)) {
            console.log('[GROUP] Empate en v' + s.v + ' de ' + gid + ': gana el de ' + s.by);
            self._logPut(g, s); applied.push({ prev: base, next: s, tie: true }); cur = s;
          }
          return;
        }
        if (s.v > cur.v + 1 && !gsIsBoss(cur, s.by)) { gap = true; return; }
        if (!self._verify(s)) return;
        var err = gsStepError(cur, s);
        if (err) { console.warn('[GROUP] Cambio v' + s.v + ' de ' + s.by + ' en ' + gid + ' descartado: ' + err); return; }
        if (!g.sl) g.sl = [];
        self._logPut(g, s); applied.push({ prev: cur, next: s }); cur = s;
      });
    }
    if (applied.length) {
      var last = applied[applied.length - 1].next;
      if (env && typeof env.pi === 'string' && last.ph && groupPhotoHash(env.pi) === last.ph && PH_RE.test(env.pi) && env.pi.length <= PH_MAX) this._photoPut(gid, last.ph, env.pi);
      if (env && env.sp && !validatePointer(env.sp)) g.sp = env.sp;
      this._applied(g, applied, false);
    }
    return { applied: applied, gap: gap };
  },
  // Después de aplicar: lista, nombre, si me sacaron, y los avisos en el chat
  _applied(g, applied, mine) {
    var self = this, me = this._me(), s = g.s;
    g.members = s.m.slice();
    g.name = s.n;
    if (s.m.indexOf(me) < 0 && !g.left) {
      g.kicked = true;
      var by = applied[applied.length - 1].next.by;
      if (!mine) { self._notice(g.id, by, '🚫 ' + t('grp_n_you_out', 'Te expulsaron del grupo')); _toast('🚫 ' + t('grp_n_you_out', 'Te expulsaron del grupo') + ' «' + g.name + '»'); }
    }
    if (!mine) applied.forEach(function(a) {
      if (a.tie) return;
      if (a.join) { self._notice(g.id, a.next.by, '👥 ' + (a.next.v === 1 ? t('grp_n_created', 'Creó el grupo ') + '«' + a.next.n + '»' : t('grp_n_you_in', 'Te agregaron al grupo'))); return; }
      var txt = self._diffText(a.prev, a.next);
      if (txt && a.next.by !== me) self._notice(g.id, a.next.by, txt);
    });
    if (s.ph && !this.photoOf(g.id)) this._photosLoad();
    this._save();
    _emit('nexo:groups', { id: g.id });
  },
  _diffText(prev, next) {
    var d = gsDiff(prev, next), n = [], nm = this.memberName.bind(this), me = this._me();
    var who = function(l) { return l.map(function(x) { return x === me ? t('prof_group_you', 'tú') : nm(x); }).join(', '); };
    if (d.left) return t('grp_left_msg', '👋 Salió del grupo') + (d.creator ? ' · ' + t('grp_n_boss', 'Ahora administra el grupo: ') + who([d.creator]) : '');
    if (d.added.length) n.push(t('grp_n_added', 'Nuevo en el grupo: ') + who(d.added));
    var blk = d.removed.filter(function(x) { return d.blocked.indexOf(x) >= 0; }), out = d.removed.filter(function(x) { return d.blocked.indexOf(x) < 0; });
    if (out.length) n.push(t('grp_n_kicked', 'Expulsado del grupo: ') + who(out));
    if (blk.length) n.push(t('grp_n_kicked_bl', 'Expulsado y bloqueado en este grupo: ') + who(blk));
    if (d.unblocked.length) n.push(t('grp_n_unblocked', 'Desbloqueado en este grupo: ') + who(d.unblocked));
    if (d.promoted.length) n.push(t('grp_n_admin', 'Ahora es admin: ') + who(d.promoted));
    if (d.demoted.length) n.push(t('grp_n_unadmin', 'Ya no es admin: ') + who(d.demoted));
    if (d.name !== undefined) n.push(t('grp_n_name', 'Nombre del grupo: ') + '«' + d.name + '»');
    if (d.photo !== undefined) n.push(d.photo ? t('grp_n_photo', 'Foto del grupo nueva') : t('grp_n_photo0', 'Se quitó la foto del grupo'));
    if (d.mode !== undefined) n.push(d.mode === 'c' ? t('grp_n_mode_c', 'Modo Control') : t('grp_n_mode_o', 'Modo Colegas'));
    if (d.ow !== undefined) n.push(d.ow ? t('grp_n_ow1', 'Solo los administradores escriben') : t('grp_n_ow0', 'Todos pueden escribir'));
    if (d.oa !== undefined) n.push(d.oa ? t('grp_n_oa1', 'Solo los administradores agregan') : t('grp_n_oa0', 'Todos pueden agregar'));
    return n.length ? '👥 ' + n.join(' · ') : '';
  },
  // Aviso en el chat del grupo, escrito AQUÍ (no el texto que mandó el otro), como un mensaje de quien hizo el cambio
  _notice(gid, by, text) {
    var id = 'gsn' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
    var msg = { messageId: id, msgId: id, content: JSON.stringify({ type: 'nexo_txt', t: text }), _own: false, status: 'delivered', timestamp: Date.now(), senderNexoId: by, senderName: this.memberName(by), groupId: gid };
    if (window.vaultAppendMessage) window.vaultAppendMessage(gid, Object.assign({}, msg)).catch(function() {});
    this.noteMessage(gid, this.memberName(by) + ': ' + text, msg.timestamp);
    _emit('nexo:ble:messageReceived', msg);
  },
  _takeCards(g, env, nx) {
    var me = this._me();
    if (!Array.isArray(env.k) || !this.ble || typeof this.ble.addSharedContacts !== 'function') return;
    var cards = env.k.filter(function(c) { var id = _nid(c && c.nexoId); return id !== me && id !== nx && g.members.indexOf(id) >= 0; });
    if (cards.length) this.ble.addSharedContacts(cards, nx, { quiet: true });
  },

  // ---- ponerse al día ----
  _syncCheck(g, env, from) {
    if (env.sv === undefined) return;
    var sv = Number(env.sv) || 0, v = g.s ? g.s.v : 0;
    if (sv > v) { this._askState(g.id, from); if (env.sp) this._fetchCopy(g.id, env.sp); }
    else if (sv < v) this._pushState(g.id, from);
  },
  _throttle(key) {
    this._syncAt = this._syncAt || new Map();
    var now = Date.now();
    if (now - (this._syncAt.get(key) || 0) < SYNC_EVERY_MS) return false;
    this._syncAt.set(key, now);
    return true;
  },
  _askState(gid, nx) {
    if (!this._throttle('q|' + gid + '|' + nx)) return;
    console.log('[GROUP] Voy atrasado en ' + gid + ': le pido el estado a ' + nx);
    this.sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), null, null, [nx], null, { q: 1 });
  },
  _pushState(gid, nx, force) {
    var g = this.get(gid);
    if (!g || !g.s || (!force && !this._throttle('p|' + gid + '|' + nx)) || (force && !this._throttle('P|' + gid + '|' + nx))) return;
    console.log('[GROUP] ' + nx + ' va atrasado en ' + gid + ': le mando el estado v' + g.s.v);
    var extra = { s: this._chain(g) }, ph = this.photoOf(gid);
    if (ph) extra.pi = ph;
    if (g.sp) extra.sp = g.sp;
    var cards = typeof window.NEXO_groupCards === 'function' ? window.NEXO_groupCards(g) : null;
    this.sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), null, null, [nx], cards, extra);
  },

  // ---- copia cifrada del estado en el buzón de archivos (relés; 7 días; cada cambio sube una nueva) ----
  _stageCopy(g) {
    var self = this, net = this.ble && this.ble.net;
    if (!net || typeof net.online !== 'function' || !net.online() || !g.sl || !g.sl.length) return;
    var data = _bytesToB64(new TextEncoder().encode(JSON.stringify({ t: 'nexo_gs', g: g.id, s: g.sl })));
    var v = g.s.v;
    stageBlob(net, data).then(function(res) {
      if (!g.s || g.s.v !== v) return;   // ya hubo otro cambio
      g.sp = res.pointer; self._save();
      console.log('[GROUP] Copia del estado v' + v + ' de ' + g.id + ' en el buzón de archivos (' + res.replication + ' relés)');
    }).catch(function(e) { console.warn('[GROUP] No se pudo subir la copia del estado de ' + g.id + ': ' + ((e && e.message) || e)); });
  },
  // pend: los estados que llegaron con el sobre y no se pudieron aplicar por el hueco (se aplican después de la copia)
  _fetchCopy(gid, ptr, pend) {
    var self = this, net = this.ble && this.ble.net;
    if (!ptr || validatePointer(ptr) || !net || typeof net.online !== 'function' || !net.online() || !this._throttle('f|' + gid)) return;
    fetchBlob(net, ptr).then(function(res) {
      var o = JSON.parse(new TextDecoder().decode(_b64ToBytes(res.b64)));
      if (!o || o.t !== 'nexo_gs' || _nid(o.g) !== gid || !Array.isArray(o.s)) return;
      var g = self.list[gid];
      if (!g || g.left || g.kicked) return;
      var r = self._applyChain(gid, o.s.concat(Array.isArray(pend) ? pend : []), (g.s && g.s.by) || '', null);
      console.log('[GROUP] Copia del estado de ' + gid + ' bajada del buzón: ' + r.applied.length + ' cambio(s) aplicados');
    }).catch(function(e) { console.warn('[GROUP] No se pudo bajar la copia del estado de ' + gid + ': ' + ((e && e.message) || e)); });
  }
};
