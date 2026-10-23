// Nombres usados sin definir en los módulos de src/ (los que no son del navegador). Red de seguridad al mover código
// entre archivos: si falta un import, sale aquí antes de ejecutar nada.
// Uso: node undef.js [archivo.js ...]   (sin argumentos: lo que entra en la APK, desde src/main.js)   → sale con código 1 si hay alguno
'use strict';
const fs = require('fs');
const path = require('path');
const deps = path.join(__dirname, '.deps/node_modules');
const acorn = require(path.join(deps, 'acorn'));
const escope = require(path.join(deps, 'eslint-scope'));
const ROOT = path.join(__dirname, '../../src');
// Globales del navegador y del entorno que la app usa a propósito
// ERROR_CODES: campo estático de clase (nap.js) que eslint-scope 5 no entiende
const OK = new Set(('ERROR_CODES window document navigator console setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame ' +
  'Promise Map Set WeakMap WeakSet Array Object String Number Boolean Math Date JSON RegExp Error TypeError RangeError Symbol BigInt Uint8Array Uint16Array Uint32Array Int8Array Int16Array Int32Array Float32Array Float64Array ArrayBuffer DataView ' +
  'TextEncoder TextDecoder atob btoa crypto CustomEvent Event MouseEvent KeyboardEvent Blob File FileReader URL Image Audio HTMLElement HTMLCanvasElement HTMLVideoElement Node NodeList ' +
  'MediaRecorder MediaStream AudioContext webkitAudioContext OfflineAudioContext localStorage sessionStorage indexedDB location history performance fetch WebSocket XMLHttpRequest ' +
  'getComputedStyle matchMedia alert confirm prompt structuredClone queueMicrotask encodeURIComponent decodeURIComponent encodeURI decodeURI escape unescape isNaN isFinite parseInt parseFloat ' +
  'undefined NaN Infinity globalThis self module require process __dirname arguments Intl Reflect Proxy AbortController DOMParser MutationObserver ResizeObserver IntersectionObserver ' +
  'ImageData OffscreenCanvas createImageBitmap VideoFrame VideoEncoder VideoDecoder AudioEncoder EncodedVideoChunk ClipboardItem PointerEvent TouchEvent CompressionStream DecompressionStream Response Request Headers ReadableStream WritableStream TransformStream').split(/\s+/));
function check(file) {
  const src = fs.readFileSync(file, 'utf8');
  let ast;
  try { ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true, ranges: true }); }
  catch (e) { return [`${file}: no se puede leer: ${e.message}`]; }
  const sm = escope.analyze(ast, { ecmaVersion: 2022, sourceType: 'module' });
  const out = [];
  const g = sm.globalScope;
  g.through.forEach((ref) => {
    const n = ref.identifier.name;
    if (!OK.has(n)) out.push(`${path.relative(process.cwd(), file)}:${ref.identifier.loc.start.line} ${n}`);
  });
  return out;
}
function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []); }
// Sin argumentos: solo lo que entra en la APK (los import desde src/main.js, a cualquier profundidad)
function reachable(entry) {
  const seen = new Set(), todo = [entry];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    if (!f.endsWith('.js')) continue;
    seen.add(f);
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/(?:^|\n)\s*import\s+(?:[^'"]*?from\s+)?['"](\.[^'"]+)['"]/g)) todo.push(path.resolve(path.dirname(f), m[1]));
  }
  return Array.from(seen);
}
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => path.resolve(f)) : reachable(path.join(ROOT, 'main.js'));
const all = files.flatMap(check);
const byName = {};
all.forEach((l) => { const n = l.split(' ').pop(); (byName[n] = byName[n] || []).push(l.split(' ')[0]); });
Object.keys(byName).sort().forEach((n) => console.log(n.padEnd(28) + byName[n].length + '×  ' + byName[n].slice(0, 3).join(', ')));
console.log(all.length ? `${Object.keys(byName).length} nombre(s) sin definir` : 'Sin nombres sin definir');
process.exit(all.length ? 1 : 0);
