// 3318 (llamadas por relés: datos): durante una llamada la escucha nativa de internet (NetBg) no arranca aunque la app se vaya a segundo
// plano (la app viva ya recibe; antes bajaba dos veces cada parte de la llamada). Al colgar con la app oculta, se le pasa a la parte nativa
// lo último que vio la app y el nativo arranca la escucha (si no, bajaría otra vez toda la llamada desde que se ocultó).
export function callEndedBg(bi) {
  try {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') return false;
    var net = bi && bi.net;
    if (!net || typeof net._bgConfig !== 'function') return false;
    net._bgSinceDirty = true; net._bgConfig();
    return true;
  } catch (e) { return false; }
}
