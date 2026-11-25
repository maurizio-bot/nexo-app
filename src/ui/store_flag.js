/**
 * NEXO — Bandera de la versión «de tienda» (Google Play), COLA 26.
 * La APK de GitHub (pruebas) lleva su actualizador propio y puede instalar APK recibidas por chat; Google Play no admite ni lo uno ni
 * lo otro (la app se actualiza por Play; REQUEST_INSTALL_PACKAGES exige una declaración que NEXO no puede justificar). La compilación de
 * tienda se marca con window.NEXO_STORE = '1' (index.html trae «__NEXO_STORE__»; el CI de tienda lo reemplaza por 1, igual que
 * «__NEXO_BUILD__»). Cualquier otro valor —incluido el texto «__NEXO_STORE__» sin reemplazar de la APK de GitHub— es «no tienda».
 * Sin importaciones: lo usan updater.js, profile.js y file_card.js sin crear ciclos.
 */
export function isStoreBuild() {
  try { var s = (typeof window !== 'undefined') ? window.NEXO_STORE : undefined; return s === '1' || s === 1 || s === true; } catch (e) { return false; }
}
// I-S1/T-A1 (auditoría 23-11): la MISMA regla que el nativo (OpenType.kt), con los mismos casos (tests/sim/opentype_vectors.json):
// el nombre se sanea igual (sin control ni RTL, solo [A-Za-z0-9._ ()-], tope 80 conservando la extensión) y «es APK» = ese nombre
// termina en «.apk». Antes «x.apk » (con espacio) o un nombre largo pasaban por PDF aquí y el nativo los instalaba. Un tipo de APK
// con otro nombre no es APK: el nativo lo abre como octet-stream, nunca con el instalador.
var _INVISIBLE = /[\u0000-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩﻿]/g;
/** Nombre con el que el nativo guarda y abre el archivo (OpenType.safeName). */
export function openSafeName(name) {
  var s = String(name == null ? '' : name);
  s = s.substring(s.lastIndexOf('/') + 1); s = s.substring(s.lastIndexOf('\\') + 1);
  s = s.replace(_INVISIBLE, '').replace(/[^A-Za-z0-9._ ()\-]/g, '_').trim().replace(/^\.+/, '');
  var n = s || 'archivo';
  if (n.length <= 80) return n;
  var dot = n.lastIndexOf('.'), ext = dot >= 0 ? n.substring(dot + 1) : '';
  return (ext.length >= 1 && ext.length <= 10 && ext.length < n.length - 1) ? n.substring(0, 80 - ext.length - 1).trimEnd() + '.' + ext : n.substring(0, 80);
}
/** Nombre para MOSTRAR (tarjeta del archivo): sin caracteres de control ni de dirección (RTL), que disfrazan la extensión. */
export function displayFileName(name) {
  return String(name == null ? '' : name).replace(_INVISIBLE, '').trim() || 'archivo';
}
/** ¿Es un APK? Decide por el nombre ya saneado (igual que el nativo); en la tienda no se abre con el instalador. */
export function isApkFile(name, mime) { // eslint-disable-line no-unused-vars
  return /\.apk$/i.test(openSafeName(name));
}
