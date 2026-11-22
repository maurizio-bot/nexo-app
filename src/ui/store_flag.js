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
/** ¿Es un APK? (por tipo o por extensión): en la tienda no se abre con el instalador. */
export function isApkFile(name, mime) {
  return String(mime || '') === 'application/vnd.android.package-archive' || /\.apk$/i.test(String(name || ''));
}
