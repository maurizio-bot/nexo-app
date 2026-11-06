/**
 * profile_data.js — Datos de MI perfil (ronda 2910, pedido del dueño 04-11): además del NEXO ID y la foto, campos
 * OPCIONALES que cada uno llena o no — nombre y apellido, teléfono, correo. Se guardan cifrados en reposo (plugin
 * loadFromFile/saveToFile, como la foto de perfil y el fondo). Paso 1: solo guardar/leer/editar lo mío y mostrar el
 * perfil de un contacto. El COMPARTIR (que viajen —enmascarados— en la solicitud y completos al aceptar) es el paso 2.
 */
var MY_FILE = 'nexo_my_profile.json';
var _mine = { name: '', phone: '', email: '' };
var _loaded = false;

// Límites y validación suave (se guarda lo que el dueño elija; esto solo evita basura/inyección).
var NAME_MAX = 60, PHONE_MAX = 24, EMAIL_MAX = 80;
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function _clean(s, max) { return String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max); }
function _cleanPhone(s) { return String(s == null ? '' : s).replace(/[^0-9+()\-\s]/g, '').trim().slice(0, PHONE_MAX); }

function _pl() { return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE) || null; }
function _load(name) {
  var pl = _pl();
  if (!pl || typeof pl.loadFromFile !== 'function') return Promise.resolve(null);
  return pl.loadFromFile({ filename: name }).then(function (r) { return r && r.exists && r.content ? JSON.parse(r.content) : null; }).catch(function () { return null; });
}
function _save(name, obj) { var pl = _pl(); if (pl && typeof pl.saveToFile === 'function') pl.saveToFile({ filename: name, content: JSON.stringify(obj) }).catch(function () {}); }

export function profileInit() {
  if (_loaded) return;
  _loaded = true;
  _load(MY_FILE).then(function (o) {
    if (o && typeof o === 'object') {
      _mine = { name: _clean(o.name, NAME_MAX), phone: _cleanPhone(o.phone), email: _clean(o.email, EMAIL_MAX) };
    }
  });
}

// Copia de mis datos (para pintar / compartir). Siempre devuelve los 3 campos (string, '' si no hay).
// #dueño 06-11: el NOMBRE es SIEMPRE el fijo del install (bi.localDeviceName), el MISMO en todos lados (lista, ficha,
// al agregar por ID, al compartir por E2E) y NO se edita. Acá solo se guardan los EXTRAS opcionales (teléfono, correo).
function _installName() { try { return String((typeof window !== 'undefined' && window.bleInterface && window.bleInterface.localDeviceName) || '').trim(); } catch (e) { return ''; } }
export function myProfile() { return { name: _installName(), phone: _mine.phone || '', email: _mine.email || '' }; }
export function hasAnyProfile() { return !!(_mine.phone || _mine.email); }   // extras opcionales (el nombre siempre está)

// Guarda los EXTRAS (teléfono, correo). El nombre NO se edita acá (es el fijo del install). Devuelve { ok, email_bad }.
export function setMyProfile(fields) {
  fields = fields || {};
  var email_bad = false;
  if (fields.phone != null) _mine.phone = _cleanPhone(fields.phone);
  if (fields.email != null) {
    var e = _clean(fields.email, EMAIL_MAX);
    if (e && !EMAIL_RE.test(e)) email_bad = true;   // se guarda igual (el dueño manda), solo se avisa
    _mine.email = e;
  }
  _save(MY_FILE, { phone: _mine.phone, email: _mine.email });
  return { ok: true, email_bad: email_bad };
}

// ===== Enmascarado para el paso 2 (decisión del dueño 04-11): en la solicitud, teléfono = últimos dígitos, correo =
// primeras letras. Aquí lo dejamos listo (funciones puras) para reusar al compartir. =====
export function maskPhone(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  var last = digits.slice(-2);                 // últimos 2 dígitos
  return '•••••' + last;
}
export function maskEmail(email) {
  email = String(email || '');
  var at = email.indexOf('@');
  if (at <= 0) return '';
  var user = email.slice(0, at);
  var head = user.slice(0, Math.min(2, user.length)); // primeras 2 letras
  return head + '•••@•••';
}

// Ganchos para el simulador (jsdom no tiene el plugin nativo, pero esto es JS puro, así que anda igual)
try {
  if (typeof window !== 'undefined') {
    window.NEXO_setMyProfile = setMyProfile;
    window.NEXO_myProfile = myProfile;
    window.NEXO_maskPhone = maskPhone;
    window.NEXO_maskEmail = maskEmail;
  }
} catch (e) {}
