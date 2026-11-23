// I-X3 (auditoría 23-11): antes esto era un <script> en línea en index.html, y por él la CSP necesitaba 'unsafe-inline'
// (que deja correr cualquier script inyectado). Ahora los dos valores van en <meta> (el CI sigue reemplazando
// «__NEXO_BUILD__» y la tienda «__NEXO_STORE__» en dist/index.html, sin cambios) y este archivo, copiado tal cual a
// dist/assets por CopyWebpackPlugin, los pasa a window antes de que arranque el bundle (que va con defer, después).
(function () {
  function m(n) { var e = document.querySelector('meta[name="' + n + '"]'); return e ? e.getAttribute('content') : ''; }
  window.NEXO_BUILD = m('nexo-build');
  window.NEXO_STORE = m('nexo-store');
})();
