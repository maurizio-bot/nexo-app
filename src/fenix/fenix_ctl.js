// Decisión del dueño 23-11 (6A, auditoría C-N2): «borra mi fragmento» (fd) y «¿lo sigues teniendo?» (fp) de Fénix van FIRMADOS con la
// identidad de quien los manda, dirigidos a ese guardián y con la hora. Antes viajaban en claro: cualquiera cerca mandaba {type:'fd', from:X}
// y el guardián borraba el fragmento de X (con el teléfono de X perdido, su cuenta quedaba irrecuperable); con fp se sabía quién guarda a quién.
import { e2eSign } from '../vault/e2e_crypto.js';

var FCTL_SKEW_MS = 15 * 60 * 1000;
function _nid(id) { return (id || '').toString().toLowerCase().trim(); }
function _body(type, from, to, ts, n) { return 'NEXO-FCTL-v1|' + type + '|' + from + '|' + to + '|' + ts + '|' + (n || ''); }
function _b64(u8) { var s = ''; for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }
function _unb64(b) { var s = atob(b), u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

// Firma el paquete (le pone ts y sg); null si no se pudo
export function fctlSign(obj, me, to) {
  obj.ts = Date.now();
  return e2eSign(new TextEncoder().encode(_body(obj.type, _nid(me), _nid(to), obj.ts, obj.n))).then(function(sig) {
    if (!sig) return null;
    obj.sg = _b64(sig);
    return obj;
  });
}

// ¿Viene de verdad de ese contacto? (su clave de identidad guardada, no «de oídas» ni pendiente; hora cercana)
export async function fctlOk(p, from, me) {
  try {
    if (typeof p.sg !== 'string' || p.sg.length > 200 || typeof p.ts !== 'number' || Math.abs(Date.now() - p.ts) > FCTL_SKEW_MS) return false;
    var c = (window.vaultLoadContacts ? window.vaultLoadContacts() : []).find(function(x) { return _nid(x.nexoId || x.deviceUUID) === _nid(from); });
    if (!c || !c.publicKey || c.pendingKey || c.pkHearsay) return false;
    var s = crypto.subtle;
    var pub = await s.importKey('raw', _unb64(c.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await s.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, _unb64(p.sg), new TextEncoder().encode(_body(p.type, _nid(from), _nid(me), p.ts, p.n)));
  } catch (e) { return false; }
}
