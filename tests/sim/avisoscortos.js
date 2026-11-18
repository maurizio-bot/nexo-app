// 3225 (dueño 17-11, «sí» a arreglarlo): los avisos cortos de NEXO no se veían desde el 10-09. La regla «FIX #2» de critical.css
// escondía todo lo que tuviera «toast» en su clase o id (pensada para los paneles de pruebas REM), y los tres avisos de la app
// lo tienen: el informativo («Copiado», «Reenviado a…»: #perm-error-toast.info-toast), el de error (#perm-error-toast.err-toast)
// y el de estados (#nexo-est-toast). En Chromium REAL (estilos de verdad, no jsdom) se mira que cada uno se vea y que los de REM
// sigan ocultos. Contraprueba b3205: los tres ocultos.
// Uso: node avisoscortos.js <dir_build>
'use strict';
const path = require('path');
const { Radio, NativePhone } = require('./native_mock');
const { PW, bootPhone } = require('./pw_harness');
const dist = path.join(path.resolve(process.argv[2]), 'dist');
(async () => {
  const browser = await PW.chromium.launch();
  const radio = new Radio(); const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', {}); radio.add(nA); nA.load();
  const PA = await bootPhone(browser, 'A', nA, dist, { phone: true, quiet: true }); const A = PA.page;
  const r = { prueba: 'avisoscortos', build: path.basename(path.resolve(process.argv[2])) };
  Object.assign(r, await A.evaluate(() => {
    const out = {};
    const mk = (id, cls) => { const d = document.createElement('div'); d.id = id; if (cls) d.className = cls; d.textContent = 'Copiado'; d.style.cssText = 'position:fixed;top:12px;left:50%;padding:12px 20px;'; document.body.appendChild(d); const cs = getComputedStyle(d); const b = d.getBoundingClientRect(); const v = cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0 && b.height > 0; d.remove(); return v; };
    out.aviso_info = mk('perm-error-toast', 'info-toast');
    out.aviso_error = mk('perm-error-toast', 'err-toast');
    out.aviso_estados = mk('nexo-est-toast', '');
    out.rem_sigue_oculto = !mk('rem-toasts', 'rem-toast');
    return out;
  }));
  r.resultado = (r.aviso_info && r.aviso_error && r.aviso_estados && r.rem_sigue_oculto) ? 'OK' : 'FALLO';
  console.log('AVISOSCORTOS ' + JSON.stringify(r));
  await browser.close(); process.exit(0);
})().catch((e) => { console.log('AVISOSCORTOS ' + JSON.stringify({ prueba: 'avisoscortos', resultado: 'FALLO', error: String(e && e.message) })); process.exit(1); });
