// Palomitas de estado del chat: enviado ✓, entregado ✓✓, leído ✓✓ — IGUALES en todas las redes (Bluetooth / Wi-Fi /
// internet), porque el símbolo depende solo del ESTADO, no del transporte. Antes 'entregado' era una sola palomita
// (igual que 'enviado'): por Bluetooth, que suele quedarse en 'entregado', parecía distinto que por internet (que
// llega a 'leído'). Aquí se comprueba el mapeo estado→palomita en las dos funciones de render.js (_renderMessage y
// _updateMessageStatus) y que concuerde con la pantalla de pagos (nexo_app.js). El progreso de estado por cada
// transporte (que todos lleguen a entregado/leído) lo cubren net.js, background.js y unread.js.
// Uso: node palomitas.js <dir_build>    (lee <dir_build>/src/ui/render.js y <dir_build>/src/app/nexo_app.js)
'use strict';
const fs = require('fs');
const path = require('path');
const dir = path.resolve(process.argv[2] || '.');
const r = { build: path.basename(dir) };
function read(rel) { try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch (e) { return ''; } }
// El símbolo que el código asigna a un estado: en las líneas que lo mencionan al dibujar (statusIcon o
// statusEl.textContent), el primer glifo de palomita/estado entre comillas
function glyphsFor(src, status) {
  return src.split('\n')
    .filter(function(l) { return l.indexOf("=== '" + status + "'") >= 0 && (l.indexOf('statusIcon') >= 0 || l.indexOf('statusEl.textContent') >= 0); })
    .map(function(l) { var m = l.match(/'(✓✓|✓|○|°|!|✗)'/); return m ? m[1] : null; });
}
const render = read('src/ui/render.js');
const pay = read('src/app/nexo_app.js');
if (!render) { r.resultado = 'FALLO'; r.error = 'sin render.js'; console.log('PALOM ' + JSON.stringify(r)); process.exit(1); }
r.render_sent = glyphsFor(render, 'sent');          // esperado: ['✓','✓'] (una palomita, en las dos funciones)
r.render_delivered = glyphsFor(render, 'delivered'); // esperado: ['✓✓','✓✓']
r.render_read = glyphsFor(render, 'read');           // esperado: ['✓✓','✓✓']
r.pago_delivered = glyphsFor(pay, 'delivered');      // esperado: ['✓✓'] (misma convención en pagos)
function allAre(a, v) { return a.length > 0 && a.every(function(x) { return x === v; }); }
const ok = allAre(r.render_sent, '✓') && allAre(r.render_delivered, '✓✓') && allAre(r.render_read, '✓✓') &&
  (r.pago_delivered.length === 0 || allAre(r.pago_delivered, '✓✓'));
r.resultado = ok ? 'OK' : 'FALLO';
console.log('PALOM ' + JSON.stringify(r));
process.exit(ok ? 0 : 1);
