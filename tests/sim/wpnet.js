// Fondo compartido que ENTRE por internet (#dueño 08-11: «compartí fondo de vivo a tablet y no apareció»). No era un tema de
// dimensiones (el pintado usa background-size:cover y se adapta); era el TAMAÑO: por internet un evento de relé no pasa de
// ~60 KB (MAX_CONTENT) o se descarta, y el fondo pesaba hasta 520 KB → nunca llegaba por internet. Ahora el fondo compartido
// se achica para que, YA CIFRADO (AES-GCM + base64 ~×4/3 + iv/tag), entre bajo ese tope. _encFitsNet es la estimación pura.
// Uso: node wpnet.js [dir_build]
'use strict';
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'wpnet' };
  const { _encFitsNet, wpShareLimits } = await importSrc('ui/wallpaper.js');
  const lim = wpShareLimits();

  r.tope_60k = lim.netMax === 60000;
  // El lado compartido es chico (para que viaje), no el de 1080 de antes.
  r.edge_chico = lim.edge <= 720 && lim.len <= 45000;
  // El fondo compartido (data URL ≤ SHARE_LEN) + el envoltorio del wire (~300 chars) ENTRA cifrado por internet.
  r.fondo_compartido_entra = _encFitsNet(lim.len + 300, lim.netMax) === true;
  // El bug viejo: 520 KB NO entraba (se descartaba al viajar por relé) → por eso «no apareció».
  r.viejo_520k_no_entra = _encFitsNet(520000, lim.netMax) === false;
  // Borde exacto del tope cifrado.
  r.limite = _encFitsNet(60000 * 3 / 4 - 28, 60000) === true && _encFitsNet(60000 * 3 / 4, 60000) === false;
  // Robustez: lo chico entra, basura/0 entra (no rompe).
  r.chico_y_robusto = _encFitsNet(1000, 60000) === true && _encFitsNet(0, 60000) === true && _encFitsNet(null, 60000) === true;

  const ok = Object.keys(r).filter((k) => k !== 'prueba' && k !== 'resultado').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('WPNET ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('WPNET {"resultado":"FALLO","error":"' + String(e && e.message) + '"}'); process.exit(1); });
