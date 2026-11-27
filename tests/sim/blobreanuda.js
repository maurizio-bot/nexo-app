// 3356 (dueño 27-11: «no cortar un envío mientras avance, y seguir desde donde iba»): en el buzón de archivos, un trozo que ningún relé
// guardaba tiraba TODA la subida y el reintento empezaba de cero (cifrado nuevo, todos los trozos otra vez: más cupo de relés gastado).
// Prueba con un «relé» simulado (cuenta cada trozo publicado):
//  B1  un trozo que falla 2 veces a mitad de una subida que avanza: se reintenta y la subida TERMINA (antes: se cortaba toda);
//  B2  sin avance (los relés dejan de guardar): se corta, pero lo ya subido se recuerda; al volver, el siguiente intento con el mismo
//      archivo SOLO sube lo que faltaba y el archivo armado se descifra idéntico;
//  B3  contraprueba: otro archivo con el mismo id empieza de cero (no mezcla trozos).
// Uso: node blobreanuda.js [dir_build]
'use strict';
const crypto = require('crypto');
const { importSrc } = require('./srcmod');

(async () => {
  const r = { prueba: 'blobreanuda' };
  const B = await importSrc('net/blob_mailbox.js');
  B.blobCryptoUse(globalThis.crypto);
  const store = new Map(); // id → contenido b64
  let pubs = [], failFn = () => false;
  const net = {
    randomKey: () => crypto.randomBytes(32),
    blobEvent: (sk, content, exp) => ({ id: crypto.createHash('sha256').update(content).digest('hex'), content, exp }),
    publishEach: async (ev) => {
      pubs.push(ev.id);
      if (failFn(ev)) return [];
      store.set(ev.id, ev.content); return ['wss://r1.test', 'wss://r2.test'];
    },
  };
  const mk = (kb, seed) => { const a = new Uint8Array(kb * 1024); let x = seed; for (let i = 0; i < a.length; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; a[i] = x & 255; } return a; };
  const b64 = (u) => Buffer.from(u).toString('base64');
  const decode = async (st) => {
    const p = st.pointer, parts = p.chunks.map((c) => store.has(c.id) ? new Uint8Array(Buffer.from(store.get(c.id), 'base64')) : null);
    const ct = B.assembleChunks(parts, p);
    return B.decryptBlob(ct, new Uint8Array(Buffer.from(p.k, 'base64')), new Uint8Array(Buffer.from(p.nonce, 'base64')));
  };
  const o = { stallMs: 400, retryMs: 30 };

  // B1: el trozo 4 falla 2 veces (cada intento son 2 publicaciones) y luego entra
  const f1 = mk(400, 11); let fallos = 0, idx4 = null;
  failFn = (ev) => { if (idx4 === null && pubs.length === 5) idx4 = ev.id; if (ev.id === idx4 && fallos < 4) { fallos++; return true; } return false; };
  pubs = [];
  const s1 = await B.stageBlob(net, b64(f1), Object.assign({ resumeKey: 'f1' }, o));
  r.B1_termina = !!(s1 && s1.pointer && s1.pointer.chunks.length === 11);
  r.B1_identico = Buffer.from(await decode(s1)).equals(Buffer.from(f1));
  r.B1_sin_recordar_al_terminar = B._stageResumeInfo('f1') === null;

  // B2: a partir de 6 trozos guardados, ninguno más (sin avance) → se corta; luego vuelven y sigue desde donde iba
  const f2 = mk(600, 22); // 16 trozos
  let guardados = 0; failFn = () => { if (guardados >= 6) return true; guardados++; return false; };
  pubs = [];
  let corto = null;
  try { await B.stageBlob(net, b64(f2), Object.assign({ resumeKey: 'f2' }, o)); } catch (e) { corto = e && e.code; }
  await new Promise((res) => setTimeout(res, 600)); // que terminen los reintentos de los trozos de la misma tanda
  const info = B._stageResumeInfo('f2');
  r.B2_corta_sin_avance = corto === 'NET_DOWN';
  r.B2_recuerda = !!(info && info.done >= 6 && info.total === 16);
  failFn = () => false; pubs = [];
  const s2 = await B.stageBlob(net, b64(f2), Object.assign({ resumeKey: 'f2' }, o));
  r.B2_solo_lo_que_falta = pubs.length === 16 - info.done;
  r.B2_identico = Buffer.from(await decode(s2)).equals(Buffer.from(f2));

  // B3: mismo id, otro archivo → de cero
  const f3a = mk(200, 33), f3b = mk(200, 44);
  guardados = 0; failFn = () => { if (guardados >= 2) return true; guardados++; return false; };
  try { await B.stageBlob(net, b64(f3a), Object.assign({ resumeKey: 'f3' }, o)); } catch (e) {}
  await new Promise((res) => setTimeout(res, 600));
  failFn = () => false; pubs = [];
  const s3 = await B.stageBlob(net, b64(f3b), Object.assign({ resumeKey: 'f3' }, o));
  r.B3_otro_archivo_de_cero = pubs.length === s3.pointer.chunks.length && Buffer.from(await decode(s3)).equals(Buffer.from(f3b));

  const ok = Object.keys(r).filter((k) => k !== 'prueba').every((k) => r[k] === true);
  r.resultado = ok ? 'OK' : 'FALLO';
  console.log('BLOBREANUDA ' + JSON.stringify(r));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('BLOBREANUDA ' + JSON.stringify({ prueba: 'blobreanuda', resultado: 'FALLO', error: String(e && e.stack || e).slice(0, 400) })); process.exit(1); });
