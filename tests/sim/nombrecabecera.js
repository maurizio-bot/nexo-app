// Nombre del contacto en la cabecera del chat con letra grande (21-11, Redmi Note 11 Pro 5G: segunda línea cortada a la mitad).
// Local (navegador): node tests/sim/nombrecabecera.js — anchos 360–412 px y letra del sistema ×1 a ×1,6.
const { chromium } = require('playwright'); const fs = require('fs'); const R = require('path').join(__dirname, '..', '..') + '/';
const css = fs.readFileSync(R+'src/styles/critical.css','utf8') + fs.readFileSync(R+'src/styles/nexo_theme.css','utf8');
const src = fs.readFileSync(R+'src/main.js','utf8'); const fn = src.match(/function _fitContactName\(\) \{[\s\S]*?\n\}/)[0];
(async () => {
  const b = await chromium.launch(); let bad = 0;
  for (const [w, scale] of [[412,1],[360,1],[360,1.3],[393,1.3],[360,1.6]]) {
    const p = await b.newPage({ viewport: { width: w, height: 800 } });
    await p.setContent(`<style>${css} #chat-contact-name{font-size:${20*scale}px !important}</style><body class="chat-view-active"><div id="chat-header"><div id="chat-contact-info"><textarea id="chat-contact-name" rows="1">Maurizio Amistani</textarea><span id="chat-contact-subtitle">En línea</span></div></div></body>`);
    const r = await p.evaluate('(function(){' + fn + '; _fitContactName(); var e=document.getElementById("chat-contact-name"); var lh=parseFloat(getComputedStyle(e).lineHeight); var s=document.getElementById("chat-contact-subtitle"); return {h:e.clientHeight, sh:e.scrollHeight, lh:lh, encima: s.getBoundingClientRect().top < e.getBoundingClientRect().bottom - 1};})()');
    const ok = r.h >= Math.min(r.sh, 2*r.lh) - 1 && !r.encima; if (!ok) bad++;
    console.log(w+'px letra x'+scale, JSON.stringify(r), ok ? 'OK' : 'CORTADO');
    await p.close();
  }
  await b.close(); process.exit(bad ? 1 : 0);
})();
