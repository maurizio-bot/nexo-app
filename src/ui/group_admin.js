/**
 * group_admin.js (22-11, COLA 4b «Grupos: administración», G2–G5 y G9) — La parte de Groups (groups.js) que lleva el ESTADO firmado
 * del grupo (group_state.js): hacer un cambio (firmarlo, guardarlo y mandarlo), recibir los de los demás (validarlos y avisar en el
 * chat), ponerse al día con quien va adelantado o atrasado y la copia cifrada en el buzón de archivos de los relés.
 * Se mezcla en Groups.prototype (groups.js). Los permisos se hacen cumplir AL RECIBIR: un cambio o un mensaje de quien no tiene
 * permiso se descarta (registro «[GROUP] … descartado»).
 * Cómo viaja: en el sobre de grupo (nexo_grp) de siempre, con campos nuevos:
 *   s  los últimos estados firmados (hasta GS_CHAIN_SEND), en un cambio y al ponerse al día
 *   sv versión del estado que tiene quien manda (en todos los sobres de un grupo con estado) y sh, el principio de su huella:
 *      misma versión con otra huella = dos ramas (se cruzan los estados y gana la misma en los dos, gsBranchWins)
 *   sp puntero a la copia cifrada del estado en el buzón de archivos (hasta GS_LOG_KEEP estados, 7 días)
 *   q  1 = «mándame tu estado» (quien manda vio que va atrasado)
 *   pi la foto del grupo (data URL), solo cuando el cambio la trae (su huella va firmada en el estado: ph)
 * El texto (c) de un cambio lleva gs:1: el que recibe NO lo muestra; escribe él mismo el aviso con lo que de verdad cambió.
 */
import { gsClean, gsVerify, gsImplicit, gsCan, gsStepError, gsJumpError, gsBranchWins, gsNext, gsDiff, gsSigned, gsSigToB64, gsIsBoss, gsOpen, gsId, GS_LOG_KEEP, GS_CHAIN_SEND, GS_MAX_MEMBERS } from './group_state.js';
import { e2eSign, e2eMyPublicKey } from '../vault/e2e_crypto.js';
import { _getBLEContacts } from './ble_helpers.js';
import { stageBlob, fetchBlob, validatePointer, _bytesToB64, _b64ToBytes } from '../net/blob_mailbox.js';
import { setChatWallpaperFor } from './wallpaper.js';
import { t } from './i18n.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

var SYNC_EVERY_MS = 60000;      // pedir o mandar el estado a un mismo miembro, como mucho una vez por minuto
var HEAL_EVERY_MS = 10 * 60000; // quien hace de creador reafirma el estado (para quien no puede engancharse), como mucho cada 10 min por grupo
var HEAL_MAX_STEPS = 4;
var SH_LEN = 12;                // letras de la huella que viajan en cada sobre (sh)
var PH_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
var PH_MAX = 60000;

function _nid(x) { return (x || '').toString().toLowerCase().trim(); }
function _emit(name, detail) { try { window.dispatchEvent(new CustomEvent(name, { detail: detail })); } catch (e) {} }
function _toast(s) { try { if (window.NEXO_toast) window.NEXO_toast(s); } catch (e) {} }
function _inner(c) { try { var o = JSON.parse(c); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } }
function _plugin() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
// Huella corta de la foto del grupo (la que va firmada en el estado)
// (revisión 22-11: SHA-256; con una suma corta, quien reenvía el estado podía colar OTRA foto con la misma huella)
export function groupPhotoHash(img) {
  var s = String(img || '');
  return s ? ('p' + bytesToHex(sha256(new TextEncoder().encode(s)).subarray(0, 16))) : '';
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
  // Huella entera de mi estado (la que lleva en p el cambio siguiente) y su principio (viaja en cada sobre: sh)
  stateId(gid) { var g = this.get(gid); return g && g.s ? gsId(g.s) : ''; },
  _headId(g) { return g && g.s ? gsId(g.s).substring(0, SH_LEN) : undefined; },
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
    if (!g || ((g.left || g.kicked) && !opts.force)) return Promise.reject(new Error(t('grp_err_not_member', 'Ya no estás en este grupo')));
    var prev = this.state(gid), next = gsNext(prev, me, ch);
    var err = gsStepError(prev, next);
    if (err) { console.warn('[GROUP] Cambio no permitido en ' + gid + ': ' + err); return Promise.reject(new Error(t('grp_err_not_allowed', 'No tienes permiso para hacer eso en este grupo'))); }
    if (next.m.length > GS_MAX_MEMBERS) return Promise.reject(new Error(t('grp_max_a', 'Máximo ') + GS_MAX_MEMBERS + t('grp_max_people', ' personas')));
    return this._sign(next).then(function(sn) {
      // llegó otro cambio mientras se firmaba: este ya no sale del estado de ahora
      if (prev.v > 0 ? g.s !== prev : !!g.s) throw new Error(t('grp_change_lost', 'Tu último cambio en este grupo no se aplicó: otro cambio llegó antes. Si hace falta, hazlo de nuevo.'));
      if (!g.sl) g.sl = [];
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
  // Salir con estado firmado (si soy el creador, el mando pasa al admin más antiguo y, si no hay, al miembro más antiguo)
  leaveSigned(gid, quiet) {
    var s = this.state(gid), me = this._me();
    var ad = s.ad.filter(function(x) { return x !== me; }), m = s.m.filter(function(x) { return x !== me; }), cr = s.cr;
    if (s.cr === me) { cr = ad[0] || m[0] || null; if (!ad.length && cr) ad = [cr]; }
    var ch = { m: m, ad: ad, cr: cr };
    return this.change(gid, ch, { notice: t('grp_left_msg', '👋 Salió del grupo'), gl: 1, force: true, quiet: !!quiet });
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
        this._gapN = this._gapN || {};
        if (res.applied.length) delete this._gapN[gid];
        if (res.gap && g) {
          this._askState(gid, from);
          if (env.sp) this._fetchCopy(gid, env.sp, env.s);
          // Si ni con todo lo que guarda `from` me engancho (segunda vez seguida), se lo digo a quien hace de creador («atascado»):
          // él reafirma el estado y de él sí acepto el salto
          this._gapN[gid] = (this._gapN[gid] || 0) + 1;
          var boss = g.s && !gsOpen(g.s) ? (g.s.cr || g.s.ad[0]) : null;
          if (this._gapN[gid] >= 2 && boss && boss !== me) this._askState(gid, boss, true);
        }
        // Grupo viejo (sin estado): una salida que no se pudo validar sigue como antes (quita al que se va)
        if (!res.applied.length && inner && inner.gl && g && !g.s) return undefined;
        if (inner && inner.gs) return { ret: null };
      }
      if (env.q) {
        if (g && g.s && !g.left && !g.kicked && g.s.m.indexOf(from) >= 0) {
          // ¿Su estado está en mi cadena? Si no (otra rama, o demasiado atrás) y yo hago de creador, reafirmo el estado: de mí
          // acepta el salto. Después (o si no hace falta) le mando lo que tengo.
          var known = typeof env.sh !== 'string' || (g.sl || []).some(function(x) { return gsId(x).substring(0, SH_LEN) === env.sh; });
          if (env.qg && !known && !gsOpen(g.s) && gsIsBoss(g.s, me)) this._heal(gid, Number(env.sv) || 0).then(function() { self._pushState(gid, from, true); });
          else this._pushState(gid, from, true);
        }
        return { ret: null };
      }
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
        if (g.s.m.indexOf(from) < 0) { this._pushRemoval(g, from); return undefined; }   // lo de siempre lo descarta (no es miembro)
        this._syncCheck(g, env, from);
        if (!gsCan(g.s, from, 'write')) { console.warn('[GROUP] Mensaje de ' + from + ' en ' + gid + ' descartado: solo los administradores escriben'); return { ret: null }; }
      } else if (g && g.s && (g.left || g.kicked) && g.s.m.indexOf(me) < 0 && env.sv !== undefined && this._keyOf(from)) {
        // Salí (o me sacaron) y alguien me sigue escribiendo al grupo: en su teléfono sigo dentro (mi salida perdió un cruce,
        // o me volvieron a meter). Le pido su estado: si de verdad sigo dentro, repito la salida (o vuelvo a entrar si me sacaron).
        this._syncCheck(g, env, from);
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
    var applied = [], gap = false, lost = [];
    if (!chain.length) return { applied: applied, gap: false };
    if (g && g.left && !g.kicked && !g.s) return { applied: applied, gap: false };   // salí de un grupo viejo: nada
    if (g && !g.pend) {
      var r = this._applyKnown(g, chain);
      applied = r.applied; gap = r.gap; lost = r.lost;
    }
    // Entrar (invitación) o volver a entrar tras una expulsión: vale el último, firmado por un miembro, con quien manda y conmigo
    // dentro. (Si el grupo ya lo llevo y la cadena engancha, se resolvió arriba con las reglas de siempre.) También un grupo VIEJO
    // que se perdió su primer estado firmado (ya no viaja): entra como quien llega de nuevo.
    var oldLate = g && !g.pend && !g.kicked && !g.s && chain[0].v > 1;
    if (!applied.length && (!g || g.pend || g.kicked || oldLate)) {
      var top = chain[chain.length - 1];
      var ok = top.m.indexOf(me) >= 0 && top.m.indexOf(from) >= 0 && top.m.indexOf(top.by) >= 0 && (!g || !g.s || top.v > g.s.v) && this._verify(top, true);
      if (!ok) { if (!g || g.pend) console.warn('[GROUP] Estado de ' + gid + ' (de ' + from + ') no sirve para entrar al grupo'); return { applied: applied, gap: false }; }
      var prev = g && g.s ? g.s : null;
      if (!g) g = this.list[gid] = { id: gid, name: top.n, members: top.m.slice(), createdBy: top.cr || top.by, createdAt: Date.now(), lastMessageAt: 0, unreadCount: 0 };
      var impl = oldLate ? gsImplicit(g) : null;
      g.sl = [top]; g.s = top;
      g.pend = 0; g.kicked = false; g.left = false;
      applied.push(oldLate ? { prev: impl, next: top } : { prev: prev, next: top, join: true });
      gap = false;
      console.log('[GROUP] Entro al grupo ' + gid + ' con el estado v' + top.v + ' (de ' + from + ')');
    }
    if (applied.length) {
      var last = g.s;
      if (env && typeof env.pi === 'string' && last.ph && groupPhotoHash(env.pi) === last.ph && PH_RE.test(env.pi) && env.pi.length <= PH_MAX) this._photoPut(gid, last.ph, env.pi);
      if (env && env.sp && !validatePointer(env.sp)) g.sp = env.sp;
      this._applied(g, applied, false);
      // Cambios MÍOS que perdieron un cruce: no se reaplican solos (podrían ya no tener sentido); se avisa para repetirlos
      if (lost.some(function(x) { return x.by === me && x.m.indexOf(me) >= 0; })) {
        console.warn('[GROUP] Un cambio mío en ' + gid + ' perdió el cruce con otro cambio: no se aplicó');
        var lostTxt = '⚠️ ' + t('grp_change_lost', 'Tu último cambio en este grupo no se aplicó: otro cambio llegó antes. Si hace falta, hazlo de nuevo.');
        if (!g.left && !g.kicked) { this._notice(gid, g.s.by, lostTxt); _toast(lostTxt); }
      }
    }
    return { applied: applied, gap: gap };
  },
  // El grupo ya lo llevo (con estado firmado o viejo): cada estado que llega o sigue a mi estado, o abre una bifurcación desde
  // uno que guardo (gana la misma rama en todos: gsBranchWins), o es un salto de quien hace de creador, o no lo puedo enganchar.
  _applyKnown(g, chain) {
    var self = this, applied = [], lost = [], gap = false, used = {};
    var first = g.s || null;
    chain.forEach(function(s, i) {
      if (used[i]) return;
      var log = g.sl || [], head = g.s || null, id = gsId(s);
      if (!head) {
        // Grupo VIEJO (sin estado): su primer estado firmado. Cada teléfono apuntó como creador a quien le mandó el primer
        // mensaje (puede no coincidir), así que aquí vale el creador que dice el estado si es miembro: la app aún no está en la
        // tienda y los grupos viejos son los de las pruebas (no engordar con más reglas para ellos).
        if (s.v !== 1) return;
        var imp = gsImplicit(g);
        var cr = s.cr && imp.m.indexOf(s.cr) >= 0 ? s.cr : null;
        imp.cr = cr; imp.ad = cr ? [cr] : [];
        if (!self._verify(s)) return;
        var e0 = gsStepError(imp, s);
        if (e0) { console.warn('[GROUP] Primer estado de ' + s.by + ' en ' + g.id + ' descartado: ' + e0); return; }
        g.sl = [s]; g.s = s; applied.push({ prev: imp, next: s });
        return;
      }
      if (log.some(function(x) { return gsId(x) === id; })) return;   // ya lo tengo
      var pi = -1;
      if (s.p) log.forEach(function(x, k) { if (x.v === s.v - 1 && gsId(x) === s.p) pi = k; });
      if (pi >= 0 && pi === log.length - 1) {   // sigue a mi estado
        if (!self._verify(s)) return;
        var err = gsStepError(head, s);
        if (err) { console.warn('[GROUP] Cambio v' + s.v + ' de ' + s.by + ' en ' + g.id + ' descartado: ' + err); return; }
        self._logPut(g, s); applied.push({ prev: head, next: s });
        return;
      }
      if (pi >= 0) {   // bifurcación desde un estado que guardo
        var base = log[pi], alt = [], prev = base;
        for (var j = i; j < chain.length; j++) {
          var c = chain[j];
          if (used[j] || c.v !== prev.v + 1 || c.p !== gsId(prev)) continue;
          if (!self._verify(c)) break;
          var e2 = gsStepError(prev, c);
          if (e2) { console.warn('[GROUP] Cambio v' + c.v + ' de ' + c.by + ' en ' + g.id + ' (otra rama) descartado: ' + e2); break; }
          alt.push(c); used[j] = 1; prev = c;
        }
        var mine = log.slice(pi + 1);
        if (alt.length && gsBranchWins(alt, mine, base)) {
          console.log('[GROUP] Bifurcación en ' + g.id + ' desde v' + base.v + ': gana la rama de ' + alt[0].by + ' (v' + prev.v + '); se deshacen ' + mine.length + ' cambio(s) de aquí');
          lost = lost.concat(mine);
          g.sl = log.slice(0, pi + 1).concat(alt);
          if (g.sl.length > GS_LOG_KEEP) g.sl = g.sl.slice(g.sl.length - GS_LOG_KEEP);
          g.s = prev;
          applied.push({ prev: head, next: prev, fork: true });
        }
        return;
      }
      // No engancha con nada de lo que guardo. De quien hace de creador se acepta el SALTO (a su versión o a una mayor; en un
      // grupo abierto, donde todos mandan, solo a una mayor, y nunca dos veces a la misma altura del mismo firmante: sin vaivén)
      var open = gsOpen(head);
      if (gsIsBoss(head, s.by) && (s.v > head.v || (s.v === head.v && !open && head.by !== s.by)) && self._verify(s)) {
        var e3 = gsJumpError(head, s);
        if (!e3) {
          console.log('[GROUP] Salto en ' + g.id + ' de v' + head.v + ' a v' + s.v + ' (firmado por ' + s.by + ', que hace de creador)');
          g.sl = [s]; g.s = s;
          applied.push({ prev: head, next: s, fork: true });
          return;
        }
        console.warn('[GROUP] Salto a v' + s.v + ' de ' + s.by + ' en ' + g.id + ' descartado: ' + e3);
      }
      if (s.v > log[0].v) gap = true;   // lo anterior a lo que guardo es historia vieja: no se pide nada
    });
    // Varias entradas de la misma tanda acaban en un solo aviso si hubo bifurcación (lo que cuenta es de dónde a dónde)
    if (applied.some(function(a) { return a.fork; }) && first) applied = [{ prev: first, next: g.s, fork: true }];
    return { applied: applied, lost: lost, gap: gap && !applied.length };
  },
  // Después de aplicar: lista, nombre, si me sacaron (o volví), y los avisos en el chat
  _applied(g, applied, mine) {
    var self = this, me = this._me(), s = g.s, inNow = s.m.indexOf(me) >= 0;
    g.members = s.m.slice();
    g.name = s.n;
    var by = applied[applied.length - 1].next.by, wasOut = !!(g.kicked || g.left), gone = false;
    if (!inNow && mine) g.left = true;                 // mi propia salida: fuera, pero no «expulsado»
    else if (!inNow && !g.left && !g.kicked) {
      // Expulsado (dueño 22-11, opción B): el grupo DESAPARECE de su lista (como al salir); solo un aviso de por qué.
      // Lo guardado no se borra: si lo vuelven a agregar, el grupo vuelve como estaba.
      g.kicked = true; g.left = true; gone = true;
      _toast('🚫 ' + t('grp_n_you_out', 'Te expulsaron del grupo') + ' «' + g.name + '»');
    } else if (inNow && g.kicked && !applied.some(function(a) { return a.join; })) {
      // La expulsión perdió un cruce (o se deshizo): vuelvo a estar dentro
      g.kicked = false; g.left = false;
      self._notice(g.id, by, '👥 ' + t('grp_n_you_in', 'Te agregaron al grupo'));
    } else if (inNow && g.left && !g.kicked && !mine) {
      // Salí yo y mi salida perdió un cruce con otro cambio: la repito sobre el estado de ahora (sin avisos aquí: ya no lo veo)
      this._save();
      if (this._throttle('L|' + g.id)) this.leaveSigned(g.id, true).catch(function(e) { console.warn('[GROUP] No se pudo repetir la salida de ' + g.id + ': ' + (e && e.message)); });
      return;
    }
    // (quien ya estaba fuera y sigue fuera no ve avisos de lo que pase después en el grupo)
    if (!mine && !g.left && !(wasOut && !inNow)) applied.forEach(function(a) {
      if (a.join) { self._notice(g.id, a.next.by, '👥 ' + (a.next.v === 1 ? t('grp_n_created', 'Creó el grupo ') + '«' + a.next.n + '»' : t('grp_n_you_in', 'Te agregaron al grupo'))); return; }
      var txt = self._diffText(a.prev, a.next);
      if (txt && a.next.by !== me) self._notice(g.id, a.next.by, txt);
    });
    if (s.ph && !this.photoOf(g.id)) this._photosLoad();
    this._save();
    _emit('nexo:groups', gone ? { id: g.id, gone: 1 } : { id: g.id });
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
    if (d.creator !== undefined && d.creator) n.push(t('grp_n_boss', 'Ahora administra el grupo: ') + who([d.creator]));
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
    // fuera aquí y dentro allí: le pido su estado y le mando el mío (con mi salida); en los dos gana la misma rama
    if (g.left || g.kicked) { if (this._throttle('o|' + g.id + '|' + from, 10 * SYNC_EVERY_MS)) { this._askState(g.id, from); this._pushState(g.id, from); } return; }
    if (sv > v) { this._askState(g.id, from); if (env.sp) this._fetchCopy(g.id, env.sp); }
    else if (sv < v) this._pushState(g.id, from);
    // misma versión y otra huella: dos ramas. Le mando la mía (él hará lo mismo con la suya) y en los dos gana la misma
    else if (typeof env.sh === 'string' && env.sh !== this._headId(g)) this._pushState(g.id, from);
  },
  _throttle(key, ms) {
    this._syncAt = this._syncAt || new Map();
    var now = Date.now();
    if (now - (this._syncAt.get(key) || 0) < (ms || SYNC_EVERY_MS)) return false;
    this._syncAt.set(key, now);
    return true;
  },
  // stuck: ni con todo lo que guardan los demás me engancho (solo a quien hace de creador: qg)
  _askState(gid, nx, stuck) {
    if (!this._throttle((stuck ? 'Q|' : 'q|') + gid + '|' + nx)) return;
    console.log('[GROUP] Voy atrasado (o en otra rama) en ' + gid + ': le pido el estado a ' + nx + (stuck ? ' (atascado)' : ''));
    this.sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), null, null, [nx], null, stuck ? { q: 1, qg: 1 } : { q: 1 });
  },
  // force: me lo pidió (q): le mando TODO lo que guardo (hasta GS_LOG_KEEP), no solo lo último
  _pushState(gid, nx, force) {
    var g = this.get(gid);
    if (!g || !g.s || (!force && !this._throttle('p|' + gid + '|' + nx)) || (force && !this._throttle('P|' + gid + '|' + nx))) return;
    console.log('[GROUP] ' + nx + ' va atrasado (o en otra rama) en ' + gid + ': le mando el estado v' + g.s.v);
    var extra = { s: force ? (g.sl || [g.s]).slice() : this._chain(g) }, ph = this.photoOf(gid);
    if (ph) extra.pi = ph;
    if (g.sp) extra.sp = g.sp;
    var cards = typeof window.NEXO_groupCards === 'function' ? window.NEXO_groupCards(g) : null;
    this.sendText(gid, JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), null, null, [nx], cards, extra);
  },
  // Alguien que ya NO es miembro me escribe al grupo: se perdió el cambio que lo sacó (o que registró su salida). Le mando los
  // estados hasta ESE cambio (no los de después: lo que pasa en el grupo ya no es cosa suya) para que su teléfono se entere.
  _pushRemoval(g, nx) {
    var l = g.sl || [], k = -1;
    for (var i = 1; i < l.length; i++) if (l[i - 1].m.indexOf(nx) >= 0 && l[i].m.indexOf(nx) < 0) k = i;
    if (k < 0 || !this._keyOf(nx) || !this._throttle('x|' + g.id + '|' + nx)) return;
    console.log('[GROUP] ' + nx + ' escribe a ' + g.id + ' y ya no está: le mando el cambio que lo sacó (v' + l[k].v + ')');
    this.sendText(g.id, JSON.stringify({ type: 'nexo_txt', t: '', gs: 1 }), null, null, [nx], null, { s: l.slice(Math.max(0, k - GS_CHAIN_SEND + 1), k + 1) });
  },
  // REAFIRMAR (solo quien hace de creador): un estado nuevo SIN cambios, para que quien no puede engancharse con la cadena
  // (viene de una rama que perdió, o se perdió más cambios de los que se guardan) salte a él. `sv`: la versión que dice tener
  // el atascado; el salto necesita una versión igual o mayor, así que se dan los pasos que hagan falta (pocos).
  _heal(gid, sv) {
    var self = this, g = this.get(gid);
    if (!g || !g.s || gsOpen(g.s) || !gsIsBoss(g.s, this._me()) || !this._throttle('H|' + gid, HEAL_EVERY_MS)) return Promise.resolve();
    var steps = Math.max(1, Math.min(HEAL_MAX_STEPS, sv - g.s.v + 1)), p = Promise.resolve();
    console.log('[GROUP] Reafirmo el estado de ' + gid + ' (v' + g.s.v + ' + ' + steps + '): alguien no puede engancharse');
    for (var i = 0; i < steps; i++) p = p.then(function() { return self.change(gid, {}, { quiet: true }); });
    return p.catch(function(e) { console.warn('[GROUP] No se pudo reafirmar el estado de ' + gid + ': ' + (e && e.message)); });
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
