// Pruebas rápidas para la compilación automática (GitHub): si alguna falla, no se publica la APK.
// Corre los escenarios clave del simulador (de 3 en 3) y comprueba lo esencial de cada resultado.
// Uso: node ci.js <dir_build>     (antes: tests/sim/build.sh wip; CI_ONLY=internet para correr solo algunos)
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const buildDir = path.resolve(process.argv[2] || path.join(__dirname, 'builds/wip'));
const PARALLEL = Number(process.env.CI_PARALLEL) || 3;

const isTrue = (v) => v === true;
const isEmpty = (v) => Array.isArray(v) && v.length === 0;
const allDelivered = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => x === 'delivered' || x === 'read');

// tag: prefijo de la línea de resultado; checks: campo → comprobación
const SCENARIOS = [
  { name: 'textos, archivo y sin conexión', args: ['run.js'], tag: 'RESULTADO', checks: {
    corto_llega: isTrue, largo_llega: isTrue, corto_marca_entregado: isTrue, respuesta_B_llega: isTrue,
    archivo_llega_a_B: isTrue, offline_llega_al_volver: isTrue } },
  { name: 'cifrado de extremo a extremo', args: ['e2e.js', '--io-delay=25'], tag: 'E2E', checks: {
    llega_corto: isTrue, llega_largo: isTrue, llega_emojis_identico: isTrue, vista_previa_sin_medio_emoji: isTrue, llega_foto_identica: isTrue, llega_respuesta: isTrue, en_el_aire_en_claro: isEmpty } },
  { name: 'impostor', args: ['impostor.js', '--io-delay=25'], tag: 'IMPOSTOR', checks: {
    A_muestra_mensaje_del_impostor: (v) => v === false, impostor_recibe_algo: (v) => v === false, clave_de_B_intacta: isTrue, errores: isEmpty } },
  { name: 'Jump', args: ['jump.js', '--io-delay=25'], tag: 'JUMP', checks: { estados_A: allDelivered, puentes_leen_algo: isEmpty } },
  { name: 'Jump con internet por datos móviles', args: ['jump.js', '--io-delay=25', '--net'], tag: 'JUMP', checks: { estados_A: allDelivered, puentes_leen_algo: isEmpty } },
  { name: 'Wi-Fi (escaneo de la red)', args: ['lanscan.js'], tag: 'LANSCAN', checks: {
    encontrado_por: (v) => typeof v === 'string' && v.length > 0, escrituras_bluetooth: (v) => v === 0 } },
  { name: 'internet (relés)', args: ['net.js'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'relés_ven_algo': isEmpty, escrituras_bluetooth: (v) => v === 0,
    datos_moviles_foto_llega_s: (v) => typeof v === 'number', buzon_foto_llega_s: (v) => typeof v === 'number', errores: isEmpty, contenido_en_registros: (v) => v === 0,
    sin_internet_al_mandar: isTrue, boton_reintentar: isTrue, reintento_auto_foto_llega_s: (v) => typeof v === 'number',
    mensajes_con_aviso: (v) => typeof v === 'string' && /^(\d+)\/\1$/.test(v) && v !== '0/0', avisos_en_saludos_o_confirmaciones: (v) => v === 0 } },
  { name: 'internet (Tor)', args: ['net.js', '--tor'], tag: 'NET', checks: {
    texto_estado_A: (v) => v === 'delivered', 'eventos_a_los_relés_durante_el_envío': (v) => v === 0, impostor_cerrado: isTrue,
    errores: isEmpty, contenido_en_registros: (v) => v === 0 } },
  { name: 'relés solo cifrados (wss): un ws:// remoto se ignora, loopback permitido (auditoría F9)', args: ['relaytls.js'], tag: 'RELAYTLS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por internet (relés: mediano 5 MB y grande 12 MB llegan; >22 MB avisa claro)', args: ['bignet.js'], tag: 'BIGNET', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por internet (Tor directo: un archivo grande llega sin aviso de tamaño)', args: ['bignet.js', '--tor'], tag: 'BIGNET', logs: 'last_logs_bignet_tor.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'FCM «despertador» Fase 2: se intercambia el token en el saludo y al mandar se pide el toque (solo el token, sin contenido)', args: ['fcmwake.js'], tag: 'FCMWAKE', logs: 'last_logs_fcmwake.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'entrega con ahorro de batería (#dueño, como WhatsApp): B dormido/congelado → A dispara el FCM de alta prioridad con el token de B (solo el token) y el mensaje queda recuperable → entregado al despertar', args: ['wakebt.js'], tag: 'WAKEBT', logs: 'last_logs_wakebt.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'cobros (pagos Fase 1): mensaje de cobro con importe/concepto/método, tarjeta en los dos, sin inyección', args: ['cobro.js', '--io-delay=25'], tag: 'COBRO', checks: { resultado: (v) => v === 'OK' } },
  { name: 'agregar por ID a alguien lejos: solicitud, aceptar/eliminar, se conectan (alta remota)', args: ['reqadd.js'], tag: 'REQADD', checks: { resultado: (v) => v === 'OK' } },
  { name: 'no leídos y notificaciones', args: ['unread.js', '--io-delay=25'], tag: 'UNREAD', checks: {
    contador_corto_largo_foto: (v) => v === 3, notificaciones_con_app_a_la_vista: (v) => v === 0, al_abrir_chat: (v) => v === 0, A_ve_leido: isTrue,
    segundo_plano_cuenta: (v) => v === 2, notificacion: (v) => !!v && v.numero === 2, A_no_ve_leido_en_segundo_plano: isTrue,
    al_volver_cuenta: (v) => v === 0, al_volver_notificacion_quitada: isTrue, al_volver_A_ve_leido: isTrue,
    tocar_abre_chat: isTrue, tocar_cuenta: (v) => v === 0, tocar_notificacion_quitada: isTrue, repetido_cuenta_una_vez: isTrue, permiso_notificaciones_pedido: isTrue, errores: isEmpty } },
  { name: 'ID Bluetooth rotativo (no se ve el NEXO ID en el aire)', args: ['rid.js'], tag: 'RID', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por Wi-Fi (24 MB, corte y reintento)', args: ['big.js'], tag: 'BIG', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivos grandes por Bluetooth L2CAP (4 MB, corte y reintento)', args: ['big.js', '--l2', '--mb=4'], tag: 'BIG', checks: { resultado: (v) => v === 'OK' } },
  { name: 'trozos binarios por Bluetooth', args: ['binary.js', '--loss=0.02'], tag: 'BINARY', checks: { resultado: (v) => v === 'OK' } },
  { name: 'recibir con la app cerrada (buzón, ✓✓ y aviso)', args: ['background.js', '--scenario=closed', '--io-delay=25', '--app-events'], tag: 'BACKGROUND', checks: {
    llegada_a_B_tras_volver: (v) => Array.isArray(v) && v.every((x) => !/NO LLEGÓ/.test(x)),
    con_B_cerrada: (v) => !!v && v.estado_en_A.every((x) => /delivered|read/.test(x)) && v.notificaciones_B.length >= 1 && v.oculta_en_buzon_sin_aviso === true } },
  { name: 'entregado (✓✓) con la app CONGELADA en segundo plano (#dueño: el Vivo congela el JS): el nativo confirma la entrega firmada al avisar, sin esperar a que vuelva', args: ['background.js', '--scenario=frozen', '--io-delay=25', '--app-events'], tag: 'BACKGROUND', logs: 'last_logs_frozen.txt', checks: {
    entregado_sin_abrir_B: isTrue,
    estado_en_A_con_B_congelada: (v) => Array.isArray(v) && v.every((x) => /: (delivered|read)$/.test(x)),
    avisos_nativos_B: (v) => v >= 2,
    recibidos_en_B_al_volver: (v) => Array.isArray(v) && v.every((n) => n === 1) } },
  { name: 'chats de grupo (crear, escribir, texto largo, salir)', args: ['groups.js', '--io-delay=25'], tag: 'GROUPS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'grupo: la burbuja muestra ✓ al salir para alguien y ✓✓ cuando todos confirman, no ○ por un miembro inalcanzable (informe del dueño 30-10)', args: ['grupostatus.js'], tag: 'GRUPOSTATUS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'seguridad de grupos: un miembro no reescribe la lista ni cuela claves de terceros (auditoría C2)', args: ['groupforge.js'], tag: 'GROUPFORGE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'grupos: vídeo HD y archivo grande (24 MB, uno lo pide al llegar al Wi-Fi)', args: ['group_media.js'], tag: 'GROUP_MEDIA', checks: { resultado: (v) => v === 'OK' } },
  { name: 'envío al teléfono equivocado (informe del dueño: lo de la tablet para el S24 sonaba en el Vivo)', args: ['misroute.js'], tag: 'MISROUTE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'enlace parado 80 s: pings contestados, sin cortes (Bluetooth)', args: ['idle.js'], tag: 'IDLE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'enlace parado 80 s: pings contestados, sin cortes (Wi-Fi)', args: ['idle.js', '--wifi'], tag: 'IDLE', logs: 'last_logs_idle_wifi.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'volver a la app (Wi-Fi sigue), BUSCAR se para solo y reconexión sin ráfagas', args: ['resume.js'], tag: 'RESUME', checks: { resultado: (v) => v === 'OK' } },
  { name: 'lo pendiente al volver el contacto (textos largos una vez y legibles, nota de voz, en orden)', args: ['pending.js'], tag: 'PENDING', checks: { resultado: (v) => v === 'OK' } },
  { name: 'orden en el chat (reloj del otro adelantado; recibido con la app cerrada)', args: ['order.js'], tag: 'ORDER', checks: { resultado: (v) => v === 'OK' } },
  { name: 'cortes del Wi-Fi: breve (llega al volver) y largo (por Bluetooth), sin "!" mientras se espera', args: ['wificut.js'], tag: 'WIFICUT', checks: { resultado: (v) => v === 'OK' } },
  { name: 'borrar y volver a agregar un contacto (sin "Unknown"; nombre al conectar)', args: ['readd.js'], tag: 'READD', checks: { resultado: (v) => v === 'OK' } },
  { name: 'interfaz: "Agregar" con tus contactos y buscador, textos, Perfil, cambiar nombre, avisos', args: ['ui4.js'], tag: 'UI4', logs: 'last_logs_ui4.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos con la pantalla apagada (encender, ajustes, llamada sobre el bloqueo)', args: ['alerts.js'], tag: 'ALERTS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'aviso de ahorro de batería al instalar (como un permiso, #dueño): sale si no está exento, abre el ajuste del sistema, 2º paso de fabricante en los agresivos (Vivo), «Ahora no» lo pospone, no sale si ya está exento ni tras posponerlo', args: ['battery_prompt.js'], tag: 'BATPROMPT', logs: 'last_logs_battery_prompt.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'diagnóstico a 1 hora (#dueño): la «sesión anterior» también se recorta a la última hora (una línea de hace 2 h se quita, la de hace 10 min se queda); cabeceras intactas', args: ['diaghora.js'], tag: 'DIAGHORA', logs: 'last_logs_diaghora.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'scan lento / thrash (#87, #dueño): el auto-escaneo lleva throttle (un escaneo reciente no se repite antes de tiempo; el del usuario no) y el vigilante tolera 4 pings fallidos (no 2) antes de cortar un enlace vivo', args: ['thrash.js'], tag: 'THRASH', logs: 'last_logs_thrash.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'GATT roto / no_service (#87, #dueño): un contacto cuyo servicio GATT nunca aparece (no_service, MTU 23) se pausa en Bluetooth tras 4 fallos seguidos (backoff) y deja de martillar la radio; un corte normal no cuenta; al conectar bien se olvida; internet/Wi-Fi siguen', args: ['noservice.js'], tag: 'NOSERVICE', logs: 'last_logs_noservice.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'VOPR concierto (#dueño, robustez a escala): A descubre a un contacto CONOCIDO entre miles de anunciantes de RUIDO sin tormenta de callbacks (el filtro NEXO lo descarta en el controlador: el tiempo de descubrimiento NO crece con N=0→5000), respeta el límite de Android (5 startScan/30 s, difiere el del usuario si la ventana está llena) y se recupera de onScanFailed (3 backoff+reintento, 6 bloquea 30 s, 4 marca no-soportado). Determinista con semilla', args: ['vopr.js', '--seed=1337'], tag: 'VOPR', logs: 'last_logs_vopr.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'llamada en GRUPO (malla, #dueño): A invita a B y C → suenan y aceptan → malla de tramos activa (A↔B, A↔C, B↔C, regla «NEXO ID menor inicia»); la voz de cada uno llega a los otros, cifrada y con el emisor en el AAD (un paquete no se puede hacer pasar por otro), y se mezcla por tramo; un paquete manipulado se descarta; si C cuelga, A y B cierran su tramo con C y la llamada sigue', args: ['gcall.js'], tag: 'GCALL', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivo con el enlace parpadeando (#2, #dueño): una transferencia no se aborta por «Max window retries» mientras el enlace está caído (espera a que vuelva); solo gasta reintentos con el enlace arriba; el timeout global sigue siendo el límite', args: ['fileflap.js'], tag: 'FILEFLAP', logs: 'last_logs_fileflap.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'archivo a contacto OFFLINE por internet (#124, #dueño): _linkUp() por internet sigue la presencia del contacto (net.canReach), no «¿tengo yo internet?» (net.online) → contacto ausente = enlace caído: la ventana ESPERA sin tormenta ni gastar reintentos y no marca «fallido» (store-and-forward, se entrega al conectarse); con el contacto en línea aborta al tope como siempre', args: ['fileabsent.js'], tag: 'FILEABSENT', logs: 'last_logs_fileabsent.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'foto de perfil (elegir, llega a los contactos, al reiniciar, a uno nuevo, quitarla)', args: ['avatar.js'], tag: 'AVATAR', checks: { resultado: (v) => v === 'OK' } },
  { name: 'llamadas de voz (contestar, rechazar, sin respuesta, se corta)', args: ['calls.js', '--io-delay=25'], tag: 'CALLS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'suplantación: textos, archivos y llamadas sin cifrar de un teléfono ajeno que dice ser un contacto', args: ['spoof.js'], tag: 'SPOOF', checks: { resultado: (v) => v === 'OK' } },
  { name: 'confirmación (✓✓) falsa no marca entregado: acks firmados con la pareja, también en modo cerrado (auditoría C1)', args: ['ackforge.js', '--io-delay=25'], tag: 'ACKFORGE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'llamadas: micrófono y cámara (al colgar, ocupados, cortados, sin imágenes, sin permiso; codificadores y decodificadores que fallan; girar el teléfono; eco)', args: ['callmedia.js'], tag: 'CALLMEDIA', checks: { resultado: (v) => v === 'OK' } },
  { name: 'videollamada: imagen con su forma, sin estirar ni recortar, entera y en espejo con la cámara de delante (Chromium)', args: ['videoframe.js'], tag: 'VIDEOFRAME', logs: 'last_logs_videoframe.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'filtros del micrófono: eco, los dos a la vez, ruido, zumbido, saturación', args: ['voicefx.js'], tag: 'VOICEFX', checks: { resultado: (v) => v === 'OK' } },
  { name: 'nota de voz: pausar/reanudar, borrar antes de enviar, y parar el audio al grabar o al entrar llamada', args: ['voicenote.js'], tag: 'VOICENOTE', logs: 'last_logs_voicenote.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'palomitas de estado iguales en todas las redes (enviado ✓, entregado y leído ✓✓)', args: ['palomitas.js'], tag: 'PALOM', checks: { resultado: (v) => v === 'OK' } },
  { name: 'leído (✓✓ azul) por Bluetooth: el acuse pendiente se reenvía al reconectar (enlace caído al leer)', args: ['readbt.js'], tag: 'READBT', logs: 'last_logs_readbt.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'confirmaciones de lectura ON/OFF (#dueño): el ajuste apaga el ✓✓ azul que se manda (apagado: el otro se queda en «entregado»; encendido: ve «leído»); el «entregado» no se toca', args: ['readtoggle.js'], tag: 'READTOGGLE', logs: 'last_logs_readtoggle.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'stickers (#dueño): A manda un sticker a B; se ve el SVG incorporado (no el JSON), propio y recibido; id desconocido cae a 🎟️; nada de JSON a la vista', args: ['stickers.js'], tag: 'STICKER', logs: 'last_logs_stickers.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'tres en raya (#dueño): A y B juegan por el chat (acción oculta); las jugadas se propagan, el estado se mantiene en ambos, A gana la fila de arriba y una jugada fuera de turno se ignora', args: ['ttt.js'], tag: 'TTT', logs: 'last_logs_ttt.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'buscar dentro del chat (lupa en la cabecera, barra debajo: filtra burbujas propias y recibidas y cuenta coincidencias)', args: ['search.js'], tag: 'SEARCH', checks: { resultado: (v) => v === 'OK' } },
  { name: 'foto de una vez (ver una vez): llega con el flag, se consume al abrirla (borra payload/content/blob) y no se reabre', args: ['once.js'], tag: 'ONCE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'contacto: tocar la foto la abre grande (visor), tocar el nombre entra al chat; sin foto el avatar abre el chat', args: ['photo_tap.js'], tag: 'PHOTOTAP', checks: { resultado: (v) => v === 'OK' } },
  { name: 'aviso de mala señal: Bluetooth con MTU bajo (muy lento) marca «⚠ señal débil» en el subtítulo; MTU normal no', args: ['malasenal.js'], tag: 'MALASENAL', checks: { resultado: (v) => v === 'OK' } },
  { name: 'estados (Stream fase 1, «cercanos»): publicar texto 24h cifrado, llega y se guarda entre contactos, tira/ver, caducidad 25h, quitar', args: ['estados.js'], tag: 'ESTADOS', checks: { resultado: (v) => v === 'OK' } },
  { name: 'guardar en galería (#92): el visor muestra el botón y llama al nativo saveToGallery con el base64/nombre/mime; «ver una vez» no lo muestra', args: ['savegallery.js'], tag: 'SAVEGAL', checks: { resultado: (v) => v === 'OK' } },
  { name: 'atrás de Android (#101): __nexoHandleBack cierra en orden visor/estado/cámara/chat y da true; sin nada abierto da false; un overlay se cierra antes que el chat', args: ['backbtn.js'], tag: 'BACKBTN', checks: { resultado: (v) => v === 'OK' } },
  { name: 'DoS por trozo con «n» disparatado (auditoría 2804): un trozo BLE con total enorme se ignora (ni búfer, ni block-ack, ni NACK de millones de índices → sin ANR); un trozo normal se sigue aceptando', args: ['chunkdos.js'], tag: 'CHUNKDOS', logs: 'last_logs_chunkdos.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'juego secreto «Defensor NEXO» (#dueño): el reconocedor de la «N» acepta la N y rechaza recta/diagonal/corto; la clasificación se ordena y guarda; abre/cierra sin reventar; el gesto está en el espacio de abajo de Perfil (no en Ajustes, donde el scroll lo comía)', args: ['juego.js'], tag: 'JUEGO', logs: 'last_logs_juego.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'rendimiento (#dueño): mide lo real — un mensaje cuenta enviado/entregado y cronometra la ida y vuelta; el RTT entra en el resumen; la transferencia se cronometra; el panel «Rendimiento» se dibuja en Ajustes', args: ['perfmetrics.js'], tag: 'PERF', logs: 'last_logs_perfmetrics.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'XSS (auditoría P0-4): el contenido del remitente (texto, y por el mismo camino nombres/archivos) se pinta como TEXTO, nunca como HTML; sin elementos inyectados ni handlers ejecutados; CSP endurecida', args: ['xss.js'], tag: 'XSS', logs: 'last_logs_xss.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'menú de la burbuja: responder (deslizar izq/der), REACCIONAR (doble toque ❤️ y menú), copiar, reenviar, EDITAR, eliminar para mí/para todos (3 teléfonos)', args: ['chatactions.js'], tag: 'CHATACT', logs: 'last_logs_chatactions.txt', checks: {
    B_ve_cita: isTrue, deslizar_responde: isTrue, deslizar_izq_responde: isTrue, C_recibe_archivo_identico_s: (v) => typeof v === 'number',
    doble_toque_reacciona: isTrue, B_recibe_reaccion_s: (v) => typeof v === 'number', menu_reacciona: isTrue, deslizar_abajo_cierra: isTrue,
    foto_pellizco_zoom: isTrue, foto_pellizco_aleja: isTrue, foto_doble_toque_amplia: isTrue,
    barra_editar: isTrue, A_ve_editado: isTrue, B_recibe_edicion_s: (v) => typeof v === 'number', B_ve_editado: isTrue,
    B_ve_eliminado_s: (v) => typeof v === 'number', accion_falsa_ignorada: isTrue, json_visible: (v) => v === 0,
    desliz_muestra_flecha: isTrue, desliz_quita_flecha: isTrue, resumen_ubic_contenido: (v) => /Ubicación/.test(v || ''),
    resumen_ubic_campo: (v) => /Ubicación/.test(v || ''), resumen_texto: (v) => v === 'hola mundo',
    resumen_archivo_nombre: (v) => v === '📎 informe.pdf', resumen_archivo_contenido: (v) => v === '📎 foto.jpg',
    resumen_archivo_descriptor: (v) => v === '📎 video.mp4', resumen_sin_codigo: isTrue,
    subt_wifi_icono: isTrue, subt_internet_icono: isTrue, subt_bluetooth_icono: isTrue, subt_solo_icono: isTrue,
    subt_senal_debil: isTrue, nombre_es_textarea: isTrue,
    emoji_1: (v) => v === 1, emoji_2: (v) => v === 2, emoji_piel: (v) => v === 1, emoji_bandera: (v) => v === 1,
    emoji_muchos: (v) => v === 0, emoji_texto: (v) => v === 0, emoji_mixto: (v) => v === 0, errores: isEmpty } },
  ...['rechazar-cerrada', 'rechazar-viva', 'contestar-viejo', 'cruce', 'reloj', 'oferta-vieja', 'bloqueo', 'repetida', 'wifi-uno', 'video-estado', 'sin-micro', 'timbre'].map((c) => (
    { name: 'llamadas: ' + c, args: ['calls2.js', '--case=' + c], tag: 'CALLS2', logs: 'last_logs_calls2_' + c + '.txt', checks: { resultado: (v) => v === 'OK' } })),
  { name: 'pasar la cuenta a un teléfono nuevo', args: ['move.js', '--io-delay=25'], tag: 'MOVE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos por Bluetooth: segundo plano, app congelada, pantalla apagada y cerrada', args: ['notify.js', '--via=ble'], tag: 'NOTIFY', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos por Wi-Fi: segundo plano, app congelada, pantalla apagada (informe del dueño) y cerrada', args: ['notify.js', '--via=lan'], tag: 'NOTIFY', logs: 'last_logs_notify_lan.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'avisos por Jump: segundo plano, app congelada, pantalla apagada y cerrada', args: ['notify.js', '--via=jump'], tag: 'NOTIFY', logs: 'last_logs_notify_jump.txt', checks: { resultado: (v) => v === 'OK' } },
  { name: 'camino de envío (regla del dueño: Wi-Fi, internet, Bluetooth; sin brincar)', args: ['route.js'], tag: 'ROUTE', checks: { resultado: (v) => v === 'OK' } },
  { name: 'Double Ratchet y poscuántico', args: ['ratchet.js'], tag: null },
];

function runOne(sc) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const args = sc.args[0] === 'ratchet.js' ? sc.args : [sc.args[0], buildDir, ...sc.args.slice(1)];
    const child = spawn(process.execPath, args, { cwd: __dirname });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const secs = Math.round((Date.now() - t0) / 1000);
      const fails = [];
      if (code !== 0) fails.push('salió con código ' + code);
      if (sc.tag) {
        const line = out.split('\n').reverse().find((l) => l.startsWith(sc.tag + ' {'));
        let res = null;
        try { res = line && JSON.parse(line.substring(sc.tag.length + 1)); } catch (e) {}
        if (!res) fails.push('sin resultado ' + sc.tag);
        else {
          if (res.error) fails.push('error: ' + res.error);
          for (const [k, ok] of Object.entries(sc.checks)) if (!ok(res[k])) fails.push(k + ' = ' + JSON.stringify(res[k]));
        }
      }
      resolve({ sc, secs, fails, tail: out.split('\n').slice(-25).join('\n') });
    });
  });
}

(async () => {
  // CI_ONLY=texto: solo los escenarios cuyo nombre lo contiene
  const only = process.env.CI_ONLY;
  const queue = SCENARIOS.filter((sc) => !only || sc.name.includes(only)), results = [];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) {
      const r = await runOne(queue.shift());
      console.log((r.fails.length ? '✗ ' : '✓ ') + r.sc.name + ' (' + r.secs + ' s)' + (r.fails.length ? ': ' + r.fails.join('; ') : ''));
      results.push(r);
    }
  }));
  const bad = results.filter((r) => r.fails.length);
  for (const r of bad) console.log('\n--- ' + r.sc.name + ' (final de la salida) ---\n' + r.tail);
  // Registros de la app de las pruebas que fallaron (en GitHub no se pueden descargar desde todas partes)
  const fs = require('fs');
  for (const r of bad) {
    const f = path.join(__dirname, r.sc.logs || ('last_logs_' + r.sc.args[0].replace('.js', '') + '.txt'));
    if (!fs.existsSync(f)) continue;
    const lines = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/DIAG|Splash|JSDOMERROR/.test(l));
    console.log('\n--- ' + r.sc.name + ': registros (' + lines.length + ' líneas, las últimas 400) ---\n' + lines.slice(-400).map((l) => l.substring(0, 260)).join('\n'));
  }
  console.log('\n' + (bad.length ? bad.length + ' prueba(s) fallaron' : 'Todas las pruebas pasaron (' + results.length + ')'));
  process.exit(bad.length ? 1 : 0);
})();
