// Capturas de las pantallas de la app en Chromium con tamaño de teléfono (393x851), para revisar el aspecto antes y
// después de un cambio de estilo. A y B se emparejan por Bluetooth y se escriben (texto, foto, ubicación no).
// Pantallas: lista de chats (con y sin no leídos), panel de buscar dispositivos, chat (mensajes, menú de adjuntar,
// menú de un mensaje), Perfil, crear grupo, compartir contacto, pasar la cuenta.
// Uso: node ui_shots.js <dir_build> <carpeta_capturas>
'use strict';
const fs = require('fs');
const path = require('path');
const { PW, bootPhone, click, sleep } = require('./pw_harness');
const { Radio, NativePhone } = require('./native_mock');

const dist = path.resolve(process.argv[2], 'dist');
const out = path.resolve(process.argv[3] || 'shots');
fs.mkdirSync(out, { recursive: true });
const opts = { readsContentFallback: true, retain: ['onPayloadReceived'], closeOnNoService: true, pace: [5, 5], ioDelay: 10, asymmetric: true };

(async () => {
  const browser = await PW.chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const radio = new Radio();
  const nA = new NativePhone('A', 'AA:AA:AA:AA:AA:01', opts), nB = new NativePhone('B', 'BB:BB:BB:BB:BB:02', opts);
  radio.add(nA); radio.add(nB); nA.load(); nB.load();
  const logs = [];
  const [A, B] = (await Promise.all([bootPhone(browser, 'A', nA, dist, { phone: true, logs }), bootPhone(browser, 'B', nB, dist, { phone: true, logs })])).map((x) => x.page);
  const shot = async (p, name) => { await sleep(500); await p.screenshot({ path: path.join(out, name + '.png') }); };
  await shot(A, '01_inicio_vacio');
  await A.evaluate(() => window.bleInterface.togglePanel());
  for (let i = 0; i < 100; i++) { await sleep(150); const ok = await A.evaluate(() => !!document.querySelector('#ble-new-device button')); if (ok) break; const sc = await A.evaluate(() => window.bleInterface.isScanning); if (!sc) await click(A, '#ble-scan-btn'); }
  await shot(A, '02_buscar_dispositivos');
  await click(A, '#ble-new-device button'); await sleep(1500);
  await A.evaluate(() => { if (document.getElementById('ble-panel').classList.contains('active')) window.bleInterface.togglePanel(); });
  const send = (p, t) => p.evaluate((t) => { const i = document.getElementById('message-input'); i.value = t; i.dispatchEvent(new Event('input', { bubbles: true })); document.getElementById('send-btn').dispatchEvent(new MouseEvent('click', { bubbles: true })); }, t);
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await send(A, 'Hola B, ¿qué tal? 😀'); await sleep(1500);
  await click(B, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await send(B, 'Muy bien, ¿y tú? Esto es un mensaje un poco más largo para ver cómo se parte en varias líneas.'); await sleep(1500);
  await send(A, 'Genial 👍'); await sleep(1500);
  await shot(A, '03_chat');
  await click(A, '#attach-btn'); await sleep(300);
  await shot(A, '04_adjuntar');
  await click(A, '#attach-btn'); await sleep(300);
  // Menú de un mensaje (pulsación larga)
  await A.evaluate(() => { const m = document.querySelector('#messages-container .message'); if (m) { m.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 300 })); } });
  await shot(A, '05_menu_mensaje');
  await A.evaluate(() => { const m = document.getElementById('nexo-msg-menu'); if (m) m.click(); }); await sleep(300);
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400);
  await send(B, 'Otro mensaje sin leer'); await sleep(1500);
  await shot(A, '06_lista_chats');
  await click(A, '#nexo-profile-btn'); await sleep(500);
  await shot(A, '07_perfil');
  // Ronda 2765: foto de perfil con el recorte de verdad (Chromium tiene canvas): una imagen de 600x400 → círculo
  await A.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400; const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 600, 400); gr.addColorStop(0, '#ff6b35'); gr.addColorStop(1, '#a855f7'); g.fillStyle = gr; g.fillRect(0, 0, 600, 400);
    g.fillStyle = '#fff'; g.beginPath(); g.arc(300, 170, 90, 0, 7); g.fill(); g.fillRect(170, 280, 260, 120);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    document.getElementById('nexo-av-pick').click();
    await new Promise((r) => setTimeout(r, 100));
    const inp = Array.from(document.querySelectorAll('input[type=file]')).find((i) => i.accept === 'image/*');
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'yo.png', { type: 'image/png' })); inp.files = dt.files;
    inp.dispatchEvent(new Event('change'));
  });
  await sleep(1500);
  await shot(A, '07b_perfil_con_foto');
  await A.evaluate(() => { const c = document.getElementById('nexo-profile-close'); if (c) c.click(); });
  await click(A, '#nexo-new-group-btn'); await sleep(500);
  await shot(A, '08_crear_grupo');
  await A.evaluate(() => { const s = document.getElementById('nexo-group-sheet'); if (s) s.remove(); });
  await click(A, '#main-contacts-list .ble-contact-row'); await sleep(500);
  await A.evaluate(() => { const it = document.querySelector('.attach-menu-item[data-type="contact"]'); if (it) it.click(); }); await sleep(500);
  await shot(A, '09_compartir_contacto');
  await A.evaluate(() => { const s = document.getElementById('nexo-share-sheet'); if (s) s.remove(); });
  // Archivo en el chat
  await A.evaluate(() => {
    document.querySelector('.attach-menu-item[data-type="file"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const fin = Array.from(document.querySelectorAll('input[type=file]')).pop();
    const b = new Uint8Array(40000); for (let i = 0; i < b.length; i++) b[i] = (i * 7) & 255;
    Object.defineProperty(fin, 'files', { configurable: true, value: [new File([b], 'informe.pdf', { type: 'application/pdf' })] });
    fin.dispatchEvent(new Event('change'));
  });
  await sleep(4000);
  await shot(A, '10_chat_archivo');
  // Verificar la clave (QR)
  await click(A, '#e2e-banner'); await sleep(700);
  await shot(A, '11_verificar_qr');
  await A.evaluate(() => { Array.from(document.querySelectorAll('div')).filter((d) => /position: fixed/.test(d.getAttribute('style') || '') && /QR|número de seguridad|Verificar/i.test(d.textContent || '') && d.id !== 'app').forEach((d) => d.remove()); });
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400);
  // Grupo
  await A.evaluate((nx) => { const g = window.bleInterface.groups.create('Familia', [nx]); window.NEXO_openGroupChat(g.id); }, await B.evaluate(() => window.bleInterface.localNexoId.toLowerCase()));
  await sleep(600); await send(A, 'Hola a todos'); await sleep(2500);
  await shot(A, '12_chat_grupo');
  await A.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(400);
  // B ve la foto de A en su lista
  await B.evaluate(() => window.dispatchEvent(new CustomEvent('nexo:ble:closeChat', { detail: {} }))); await sleep(4000);
  await shot(B, '14_lista_B_con_foto_de_A');
  // Traer mi cuenta (pantalla con QR)
  await A.evaluate(() => window.NEXO_moveReceive && window.NEXO_moveReceive()); await sleep(1500);
  await shot(A, '13_traer_cuenta');
  fs.writeFileSync(path.join(out, 'logs.txt'), logs.join('\n'));
  await browser.close();
  console.log('SHOTS ' + fs.readdirSync(out).filter((f) => f.endsWith('.png')).length);
})().catch((e) => { console.error(e); process.exit(1); });
