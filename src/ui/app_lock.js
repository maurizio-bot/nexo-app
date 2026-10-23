/**
 * NEXO - Seguridad fase 3: bloqueo con huella y capturas de pantalla (docs/SEGURIDAD.md)
 *
 * - Bloqueo opcional (Perfil → Seguridad): al abrir NEXO y al volver tras el tiempo elegido (inmediatamente,
 *   1 min, 30 min) se pide la huella / cara / PIN del teléfono (BiometricPrompt). Mientras está bloqueada la
 *   app sigue funcionando por debajo: los mensajes llegan y se guardan; solo se tapa la pantalla.
 * - Capturas (Perfil → Seguridad): permitidas por defecto; al bloquearlas (FLAG_SECURE) tampoco se ven en
 *   "recientes" ni en grabaciones de pantalla.
 * - Estado del cifrado en reposo (los archivos de NEXO cifrados con una clave del Android Keystore; Kotlin).
 *
 * Preferencias en nexo_security.json (cifrado en reposo como todo lo demás). En localStorage solo una pista
 * "hay bloqueo" para tapar la pantalla desde el primer instante, antes de leer el archivo.
 */

var PREFS_FILE = 'nexo_security.json';
var HINT_KEY = 'nexo_lock_hint';
var AFTER_OPTIONS = [
  { ms: 0, label: 'Inmediatamente' },
  { ms: 60000, label: 'Tras 1 minuto' },
  { ms: 1800000, label: 'Tras 30 minutos' }
];
// Tras pedir la huella con el PIN del teléfono (otra pantalla de Android) la app "vuelve": no volver a bloquear
var AUTH_SETTLE_MS = 2500;

var _prefs = { lock: false, lockAfterMs: 0, secure: false };
var _locked = false;
var _authing = false;
var _lastAuthEnd = 0;
var _hiddenAt = null;
var _toast = function() {};
var _atRest = null;

function _pl() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NexoBLE; }
function _call(name, args) {
  var pl = _pl();
  if (!pl || typeof pl[name] !== 'function') return Promise.resolve(null);
  return pl[name](args || {}).catch(function(e) { console.warn('[LOCK] ' + name + ': ' + (e && e.message)); return null; });
}
function _hint(on) { try { if (on) localStorage.setItem(HINT_KEY, '1'); else localStorage.removeItem(HINT_KEY); } catch (e) {} }
function _hinted() { try { return localStorage.getItem(HINT_KEY) === '1'; } catch (e) { return false; } }

function _save() {
  _hint(_prefs.lock);
  return _call('saveToFile', { filename: PREFS_FILE, content: JSON.stringify({ v: 1, lock: _prefs.lock, lockAfterMs: _prefs.lockAfterMs, secure: _prefs.secure }) });
}

// ---------- Pantalla de bloqueo ----------
function _overlay() { return document.getElementById('nexo-lock'); }
function _showLock() {
  _locked = true;
  if (_overlay()) return;
  var o = document.createElement('div');
  o.id = 'nexo-lock';
  o.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#0a0a15;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:inherit;padding:24px;box-sizing:border-box;text-align:center;';
  o.innerHTML = '<div style="font-size:56px;">🔒</div>' +
    '<div style="font-size:20px;font-weight:700;">NEXO está bloqueado</div>' +
    '<div id="nexo-lock-msg" style="font-size:14px;opacity:0.75;min-height:20px;">Usa tu huella o el PIN del teléfono</div>' +
    '<button id="nexo-lock-btn" style="background:linear-gradient(135deg,#00c8ff,#a855f7);color:#fff;border:none;border-radius:14px;padding:14px 28px;font-size:16px;font-weight:600;">Desbloquear</button>';
  (document.body || document.documentElement).appendChild(o);
  o.querySelector('#nexo-lock-btn').onclick = function() { _unlock(); };
}
function _hideLock() {
  _locked = false;
  var o = _overlay();
  if (o) o.remove();
}
function _lockMsg(t) { var m = document.getElementById('nexo-lock-msg'); if (m) m.textContent = t; }

async function _auth(title, subtitle) {
  _authing = true;
  try {
    var r = await _call('biometricAuth', { title: title, subtitle: subtitle || '' });
    return !!(r && r.ok);
  } finally {
    _authing = false;
    _lastAuthEnd = Date.now();
  }
}

async function _unlock() {
  if (_authing) return;
  var st = await _call('biometricStatus');
  if (!st) { _hideLock(); return; } // sin plugin nativo (navegador): no hay con qué comprobar
  if (!st.available) {
    // El teléfono ya no tiene huella ni PIN: no dejar al usuario fuera de su cuenta para siempre
    _prefs.lock = false;
    await _save();
    _hideLock();
    _toast('🔓 Bloqueo desactivado: el teléfono ya no tiene huella ni PIN', 4000);
    console.warn('[LOCK] Sin huella ni PIN en el teléfono: bloqueo desactivado');
    return;
  }
  _lockMsg('Esperando la huella…');
  var ok = await _auth('Desbloquear NEXO', '');
  if (ok) { _hideLock(); _hiddenAt = null; console.log('[LOCK] Desbloqueado'); }
  else _lockMsg('No se pudo comprobar. Toca Desbloquear para intentarlo otra vez.');
}

function _onVisibility() {
  if (!_prefs.lock) return;
  if (document.visibilityState === 'hidden') {
    if (_authing || _locked) return;
    _hiddenAt = Date.now();
    // Con "inmediatamente" se tapa ya: en "recientes" no se ve el chat
    if (_prefs.lockAfterMs === 0) _showLock();
    return;
  }
  if (_authing || Date.now() - _lastAuthEnd < AUTH_SETTLE_MS) { _hiddenAt = null; return; }
  if (_locked) { _unlock(); return; }
  if (_hiddenAt != null && Date.now() - _hiddenAt >= _prefs.lockAfterMs) { _showLock(); _unlock(); }
  _hiddenAt = null;
}

// ---------- Arranque ----------
export function initAppLock(opts) {
  if (opts && typeof opts.toast === 'function') _toast = opts.toast;
  if (_hinted()) _showLock(); // tapar desde el primer instante
  document.addEventListener('visibilitychange', _onVisibility);
  var load = function() {
    var pl = _pl();
    if (!pl || typeof pl.loadFromFile !== 'function') { _hideLock(); return; }
    pl.loadFromFile({ filename: PREFS_FILE }).then(function(r) {
      if (r && r.exists && r.content) {
        try {
          var p = JSON.parse(r.content);
          _prefs.lock = !!p.lock;
          _prefs.lockAfterMs = AFTER_OPTIONS.some(function(o) { return o.ms === p.lockAfterMs; }) ? p.lockAfterMs : 0;
          _prefs.secure = !!p.secure;
        } catch (e) { console.warn('[LOCK] Preferencias ilegibles'); }
      }
    }).catch(function(e) {
      // Si no se puede leer (p. ej. cifrado no disponible) y había bloqueo, se deja bloqueado
      console.warn('[LOCK] No se pudieron leer las preferencias: ' + (e && e.message));
      if (_hinted()) _prefs.lock = true;
    }).then(function() {
      _hint(_prefs.lock);
      if (_prefs.secure) _call('setSecureScreen', { on: true });
      if (_prefs.lock) { _showLock(); if (document.visibilityState !== 'hidden') _unlock(); }
      else _hideLock();
      console.log('[LOCK] Seguridad: bloqueo ' + (_prefs.lock ? 'sí (' + _prefs.lockAfterMs / 1000 + ' s)' : 'no') + ', capturas ' + (_prefs.secure ? 'bloqueadas' : 'permitidas'));
    });
    _call('atRestStatus').then(function(r) {
      _atRest = r ? !!r.active : null;
      console.log('[LOCK] Cifrado en reposo: ' + (_atRest === null ? 'sin datos' : _atRest ? 'activo' : 'NO disponible') + (r && r.migration ? '; migración: ' + r.migration : ''));
      // La migración de los archivos de antes va en segundo plano: su resultado, un poco después
      if (r && r.migration === 'en curso') setTimeout(function() { _call('atRestStatus').then(function(r2) { if (r2) console.log('[LOCK] Cifrado en reposo; migración: ' + r2.migration); }); }, 20000);
      renderSecuritySection();
    });
  };
  // El plugin nativo puede tardar un instante en estar disponible
  if (_pl()) load(); else setTimeout(load, 300);
}

export function isAppLocked() { return _locked; }
// Bloqueo activado: las notificaciones no llevan el texto del mensaje
export function lockEnabled() { return !!_prefs.lock; }

// ---------- Perfil → Seguridad ----------
export function securitySectionHtml() {
  var opts = AFTER_OPTIONS.map(function(o) { return '<option value="' + o.ms + '">' + o.label + '</option>'; }).join('');
  var row = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;font-size:14px;';
  return '<div style="font-size:16px;font-weight:600;margin:8px 0;">Seguridad</div>' +
    '<div id="nexo-sec-atrest" style="font-size:12px;opacity:0.8;margin-bottom:8px;"></div>' +
    '<label style="' + row + '"><span>Bloquear NEXO con huella o PIN</span><input type="checkbox" id="nexo-sec-lock" style="width:22px;height:22px;"></label>' +
    '<label id="nexo-sec-after-row" style="' + row + '"><span>Pedirla</span><select id="nexo-sec-after" style="background:#1a1b2e;color:#fff;border:1px solid #334;border-radius:8px;padding:6px;">' + opts + '</select></label>' +
    '<label style="' + row + '"><span>Bloquear capturas de pantalla</span><input type="checkbox" id="nexo-sec-secure" style="width:22px;height:22px;"></label>' +
    '<div id="nexo-sec-msg" style="font-size:13px;color:#7fdcff;min-height:0;margin-bottom:4px;"></div>' +
    '<div style="font-size:11px;opacity:0.6;margin-bottom:12px;">Con las capturas bloqueadas NEXO tampoco se ve en "recientes" ni en grabaciones. Con el bloqueo los mensajes siguen llegando.</div>';
}

// Aviso dentro de Perfil (la hoja tapa los avisos normales) o, si no está abierto, aviso normal
function _say(t, ms) {
  var m = document.getElementById('nexo-sec-msg');
  if (m) { m.textContent = t; return; }
  _toast(t, ms);
}

export function renderSecuritySection() {
  var at = document.getElementById('nexo-sec-atrest');
  if (!at) return;
  at.textContent = _atRest === true ? '🔐 Tus datos están cifrados en este teléfono (clave del chip de seguridad de Android).'
    : _atRest === false ? '⚠️ El cifrado de los datos en este teléfono no está disponible.' : '';
  var lock = document.getElementById('nexo-sec-lock');
  var after = document.getElementById('nexo-sec-after');
  var afterRow = document.getElementById('nexo-sec-after-row');
  var secure = document.getElementById('nexo-sec-secure');
  lock.checked = _prefs.lock;
  after.value = String(_prefs.lockAfterMs);
  afterRow.style.display = _prefs.lock ? 'flex' : 'none';
  secure.checked = _prefs.secure;
  lock.onchange = async function() {
    var want = lock.checked;
    lock.disabled = true;
    try {
      var st = await _call('biometricStatus');
      if (want && !(st && st.available)) {
        _say('Primero pon una huella o un PIN en los ajustes del teléfono', 3500);
      } else if (!st || !st.available || await _auth(want ? 'Activar el bloqueo de NEXO' : 'Quitar el bloqueo de NEXO', '')) {
        _prefs.lock = want;
        await _save();
        _say(want ? '🔒 NEXO pedirá tu huella' : '🔓 Bloqueo quitado', 2500);
        console.log('[LOCK] Bloqueo ' + (want ? 'activado' : 'desactivado'));
      }
    } finally {
      lock.disabled = false;
      renderSecuritySection();
    }
  };
  after.onchange = function() {
    _prefs.lockAfterMs = Number(after.value) || 0;
    _save();
  };
  secure.onchange = async function() {
    _prefs.secure = secure.checked;
    await _call('setSecureScreen', { on: _prefs.secure });
    await _save();
    _say(_prefs.secure ? '🛡️ Capturas de pantalla bloqueadas' : 'Capturas de pantalla permitidas', 2500);
    console.log('[LOCK] Capturas ' + (_prefs.secure ? 'bloqueadas' : 'permitidas'));
  };
}
