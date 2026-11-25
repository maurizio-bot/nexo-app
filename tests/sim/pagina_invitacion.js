// 3290 — PÁGINA DEL ENLACE DE INVITACIÓN (web/i.html; se publica en la rama gh-pages). El dueño (23-11) tocó una invitación y vio
// «404 There isn't a GitHub Pages site here»: la página nunca se había publicado.
//  P1  enlace bueno (#NX…-CÓDIGO): sale «Te invitaron», el ID de quien invita, el código para pegar y «Abrir en NEXO»
//      → intent://i/NX…-CÓDIGO con scheme=nexo y package=com.nexo.app en Android (vuelve a la página si no está), nexo://i/… en lo demás;
//  P2  enlace sin código (#NX…) también vale (igual que la app);
//  P3  minúsculas y %-codificado: se aceptan igual que en la app (InviteLink.kt pasa a mayúsculas);
//  P4  enlace roto, código con letras que no están en el alfabeto (0, O, 1, I, L) o ID corto: «Enlace no válido», sin botón;
//  P5  lo de la dirección nunca se pinta como HTML (un «<img onerror>» en el «#» no crea nada);
//  P6  la página no carga nada de fuera (CSP default-src 'none', sin <script src>, sin <link>, sin <img> remotas);
//  P7  la página acepta exactamente lo mismo que InviteLink.kt (mismo patrón).
// Uso: node pagina_invitacion.js
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');

const html = fs.readFileSync(path.join(__dirname, '../../web/i.html'), 'utf8');
const kt = fs.readFileSync(path.join(__dirname, '../../plugins/nexo-ble/android/src/main/java/com/nexo/ble/InviteLink.kt'), 'utf8');
const BASE = 'https://maurizio-bot.github.io/nexo-app/i';
const ANDROID = 'Mozilla/5.0 (Linux; Android 17; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Mobile Safari/537.36';
const DESK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36';

function load(hash, ua) {
  const dom = new JSDOM(html, { url: BASE + hash, runScripts: 'dangerously', resources: new ResourceLoader({ userAgent: ua || ANDROID }), pretendToBeVisual: true });
  const d = dom.window.document;
  return {
    dom, d,
    ok: !d.getElementById('ok').hidden, bad: !d.getElementById('bad').hidden,
    inviter: d.getElementById('inviter').textContent, code: d.getElementById('code').textContent,
    href: d.getElementById('open').getAttribute('href'),
  };
}

const res = {};
function check(name, cond, info) { res[name] = cond ? 'OK' : 'FALLA'; console.log((cond ? '✓ ' : '✗ ') + name + (cond ? '' : ' → ' + JSON.stringify(info))); }

// P1
let r = load('#NX1N36C283-K7F3Q9WZ');
check('P1_android', r.ok && !r.bad && r.inviter === 'NX1N36C283' && r.code === 'NX1N36C283-K7F3Q9WZ' &&
  r.href.startsWith('intent://i/NX1N36C283-K7F3Q9WZ#Intent;') && r.href.includes(';scheme=nexo;') && r.href.includes(';package=com.nexo.app;') &&
  r.href.includes('S.browser_fallback_url=' + encodeURIComponent(BASE + '#NX1N36C283-K7F3Q9WZ')) && r.href.endsWith(';end'), r);
r = load('#NX1N36C283-K7F3Q9WZ', DESK);
check('P1_otro', r.ok && r.href === 'nexo://i/NX1N36C283-K7F3Q9WZ', r);
// P2
r = load('#NX1N36C283');
check('P2_sin_codigo', r.ok && r.inviter === 'NX1N36C283' && r.code === 'NX1N36C283' && r.href.startsWith('intent://i/NX1N36C283#Intent;'), r);
// P3
r = load('#nx1n36c283-k7f3q9wz');
const r3b = load('#NX1N36C283%2DK7F3Q9WZ');
check('P3_minusculas', r.ok && r.code === 'NX1N36C283-K7F3Q9WZ' && r3b.ok && r3b.code === 'NX1N36C283-K7F3Q9WZ', { a: r, b: r3b });
// P4
const malos = ['', '#', '#hola', '#NX1N36C28-K7F3Q9WZ', '#NX1N36C283-K7F3Q9W0', '#NX1N36C283-K7F3Q9WO', '#NX1N36C283-K7F3Q9WI',
  '#NX1N36C283-K7F3Q9W', '#NX1N36C283-K7F3Q9WZX', '#XX1N36C283-K7F3Q9WZ', '#%E0%A4%A'];
const fallan = malos.filter((h) => { const x = load(h); return !(x.bad && !x.ok); });
check('P4_malos', fallan.length === 0, fallan);
// P5
r = load('#' + encodeURIComponent('<img src=x onerror="window.PWNED=1">'));
const r5b = load('#NX1N36C283-<b>X</b>');
check('P5_sin_html', r.bad && !r.d.querySelector('img') && !r.dom.window.PWNED && r5b.bad && !r5b.d.querySelector('#inviter b'), {});
// P6
const csp = /Content-Security-Policy" content="default-src 'none'/.test(html);
const ext = /<script[^>]+src=|<link[^>]+href=|<img[^>]+src=|https?:\/\/(?!maurizio-bot\.github\.io)[a-z]/i.test(html.replace(/<!--[\s\S]*?-->/g, ''));
check('P6_nada_de_fuera', csp && !ext, { csp, ext });
// P7
const reKt = (kt.match(/Regex\("(\^\(NX[^"]+)"\)/) || [])[1];
const reHtml = (html.match(/var RE = \/(\^\(NX[^/]+)\//) || [])[1];
check('P7_igual_que_la_app', !!reKt && reKt === reHtml, { reKt, reHtml });

const all = Object.values(res).every((v) => v === 'OK');
console.log('PAGINA_INVITACION ' + JSON.stringify({ resultado: all ? 'OK' : 'FALLA', casos: res }));
process.exit(all ? 0 : 1);
