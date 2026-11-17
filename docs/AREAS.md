# NEXO — Estado por área (16-11-2026)

**Método:** cada área cuenta sus bloques de trabajo grandes sin repetir (se quitan los que dejó viejos una build posterior o la regla
«no se arreglan versiones viejas»); peso grande ×3, mediano ×2, pequeño ×1; «en prueba del dueño» cuenta 80 %; % = hecho / (hecho + falta).

Desde el 16-11 lo vigente se ordena aquí (seguridad y negocio: `nexo-private/AREAS_PRIVADAS.md`). `docs/PENDIENTES.md` queda como
historial. Al cerrar un bloque: mover la línea de «Falta» a «En prueba» o «Hecho» y recalcular la fila de la tabla.

## Resumen

| # | Área | % | Estado en una línea |
|---|---|---|---|
| 1 | Seguridad | **51 %** | Cifrado sólido y auditado; falta construir Fénix Entorno (recuperación con retrato y firma vivos). Detalle en el privado. |
| 2 | Conexión y robustez | **57 %** | Bluetooth, internet, Wi-Fi, Jump y puente funcionan; falta la entrega con la app cerrada y la pantalla apagada, el puente con la app dormida y el modo multitud. |
| 3 | Mensajes y chat | **67 %** | Todo lo básico hecho; gestos y avisos nuevos en prueba; falta el texto en el aviso con la app cerrada y el punto de encuentro. |
| 4 | Llamadas | **59 %** | Voz, vídeo, grupo, dos a la vez y pantalla compartida hechos; falta el eco, el audio fino y el gasto de datos por relés. |
| 5 | Interfaz | **66 %** | 5 idiomas y estilo unificado; falta la bienvenida ≤ 40 s (oculta) y quitar los avisos de camino en la app final. |
| 6 | Negocio y dinero | **23 %** | Plan y estudios hechos, cobros fase 1; lo demás va con la tienda y EDC. Detalle en el privado. |
| 7 | Publicación | **25 %** | Actualizador y diagnóstico para probadores hechos; la versión para Google Play casi entera por hacer (iPhone espera ingresos). |
| | **Global** | **50 %** | Media ponderada por el peso de cada área (sin iPhone: 51 %). |

Pesos de cada área (hecho / total): 1 → 18,4/36 · 2 → 24,6/43 · 3 → 18/27 · 4 → 18,4/31 · 5 → 11,2/17 · 6 → 5/22 · 7 → 7,6/30.

## 1. Seguridad — 51 %
Detalle en el repositorio privado (`nexo-private/AREAS_PRIVADAS.md`).

## 2. Conexión y robustez — 57 %
**Hecho**
- Bluetooth LE estable: pings y pong nativo, enlaces repetidos, solo a quien está cerca (3084), Bluetooth apagado/encendido (2995, 3082). ×3
- Internet por relés públicos + Tor + relés de reserva en segundos (3114). ×3
- Wi-Fi local y cambio de camino al instante, también Wi-Fi ↔ datos móviles (3023, 3085). ×2
- Jump (saltos de teléfono en teléfono). ×2
- «Agregar»: todo NEXO cercano sale al instante y con su nombre (3012/3014). ×1
- Archivos grandes hasta 1 GB, de a uno, retoman donde iban, trozos en disco (2995–3007). ×3
- Puente a internet a través de un teléfono cercano, en cadena (partes 1–4, 3072; funcionó en el coche el 16-11 con el S23). ×2
- Entrega con la app cerrada y la pantalla encendida (prueba del dueño 14-11: llegan puntuales). ×2
- Archivo a una app dormida: despertar primero y sondear (3124, 3127). ×1

**En prueba del dueño**
- Camino preparado al abrir el chat: saludo por internet al abrir y repaso al empezar a escribir (3147, APK 3075). ×1
- Entrega sin coincidir: despertador FCM por pendientes, buzón de archivos, cita para > 5 MB (fases A–D, 2967–2972; §A.19/A.22/A.24). ×3
- Desatasco del cifrado en los dos lados y aviso si se repite (3067, 3069, 3126). ×2
- Wi-Fi Direct: un envío real bien el 15-11 (3,3 MB/s); falta el vídeo de ~20 MB (PENDIENTES 15-11, resúmenes del 14-11). ×2

**Falta**
- Diagnósticos 16-11 17:38–18:18 (3077): S23 con AHORRO DE BATERÍA y NEXO cerrada desde recientes 11 veces hoy (más el fallo nativo de las 11:13): por eso «duerme» y no confirma. El «enlace_abre_cierra» S24↔S23 (3 cierres por repetido) es lo que arregla la APK 3079 (3167/3168). ×1
- Diagnósticos 16-11 16:20–16:35 (S24 y Yaelito/Xiaomi en 3077): «reenvío sin fin» a nx1e50c95d (S23): su app dormida (enlace BT físico vivo, no contesta pings ni confirma; Wi-Fi «su app no contesta»). Pedir al S23: batería «Sin restricciones», fuera de «Apps en suspensión», actualizar y su diagnóstico. El Xiaomi de Yaelito cierra NEXO al deslizarla de recientes (SwipeUpClean ×6, OneKeyClean): candado en recientes + inicio automático. ×1
- Medición engañosa: «internet listo en» cuenta también el tiempo SIN red (Yaelito 15-11: media 90,7 s, máx. 452 s; un diagnóstico con «red ninguna»). Arreglo propuesto: con red «none» no se mide (net_relays.js `_applyNetChange`/`_connect`, `_netTryAt`). Pendiente, con prueba. ×1
- «Confirmación sin firma válida de nx1n36c283: ignorada» (Yaelito 16:31:42, al arrancar): confirmaciones sin firma descartadas a propósito (auditoría C1); provocan reenvíos de más pero los mensajes llegaron. Revisar de dónde salen sin firma (¿nativo con la app dormida? → #226 Keystore). ×1
- Diagnóstico S24↔realme 3075 (16-11 15:17, «enlace_abre_cierra»): el desempate de enlaces repetidos no cierra el enlace ENTRANTE (disconnectDevice solo cierra el de cliente): el realme siguió usando un enlace de MTU 23 y mandaba cada mensaje por los dos. Arreglado en 3167/3167b (en la APK siguiente a la 3077). Ráfaga provocada además por borrar y volver a agregar el contacto (el realme cambió de anuncio varias veces → direcciones nuevas). ×1
- Diagnóstico S23 3073 (16-11): cierre por FALLO nativo a las 11:13, en segundo plano, justo tras quitar la app de recientes con la llamada de grupo fantasma viva (arreglada en la APK siguiente); sin traza en el diagnóstico: vigilar si se repite. Además, con la app cerrada (y ahorro de batería) los mensajes del S24 esperaron ~12 min hasta abrirla (#87). «Internet listo» del S23: media 20,7 s, máx. 119,6 s al cambiar de red (el relé propio lo debe bajar).
- Diagnóstico S24 3073 (16-11): el Wi-Fi con el vivo se abre y se cierra cada ~3 min porque la app del vivo duerme y no contesta la comprobación (con Bluetooth listo); revisar si conviene dejar de reintentar tan seguido. Internet listo en 0,6 s (el 15-11 eran 13,7 s): no se repitió.
- Resúmenes del 15-11 (build 3070): el S24 tardó en tener internet listo 13,7 s de media (máx. 119 s, 21 veces); el S23 gastó 11,6 %/h de batería en segundo plano (todo el teléfono) y 50,9 MB de datos móviles en NEXO. Revisar en cuanto haya diagnóstico de la 3073.
- Entrega con la app CERRADA y la pantalla APAGADA: no suena ni avisa (#87; PENDIENTES 14-11 noche, «Pruebas del dueño con la 3052»). ×3
- Puente nativo: que preste internet un teléfono con la app dormida (opción A, 3073+; PENDIENTES 13-11 y 16-11 03:17). ×3
- Modo multitud: cientos de NEXO cerca, primero los contactos (meta EDC; ESTADO 15-11). ×3
- Comprobación de identidad en la Wi-Fi contestada por el nativo con la app dormida (decisión del dueño, PENDIENTES 14-11 noche). ×2
- Batería de un día entero: latido del Wi-Fi cada 4 s, medir al final del día (PENDIENTES 15-11 tarde; robustez.json «caminos»). ×2
- Causa raíz del estado de cifrado que vuelve atrás (Nubia; PENDIENTES 13-11, 3067). ×1
- Cuotas de espacio por contacto (Grok 4; PENDIENTES 15-11 tarde). ×1
- Android 8–11 sin la ubicación activada no escanea y no avisa (robustez.json «escaneo»). ×1
- Teléfonos que se quedan en MTU 23: renegociar (robustez.json «conexion»). ×1

**Espera decisión del dueño**
- Internet rápido para archivos por conexión directa (WebRTC, paso 4; PENDIENTES 14-11 «caminos», PREPARADO).
- Relés propios / servidor TURN: decidido esperar a que NEXO dé ingresos (16-11).

## 3. Mensajes y chat — 67 %
**Hecho**
- Texto cifrado con ✓ / ✓✓ / leído; responder, reenviar, editar, eliminar, copiar. ×3
- Fotos, vídeos y archivos con miniaturas; guardar en la galería con respuesta (3130). ×2
- Notas de voz como archivo, a 1,5× y 2× (3015, 3132). ×2
- Grupos: texto y adjuntos (≤ 5 MB por internet, una sola subida), desatasco también en grupos (2971, 3071). ×3
- Estados v3, me gusta, stickers, reacciones, cobros en el chat. ×2
- Avisos limpios: uno por chat, sin fantasmas ni repetidos, tocar abre el chat (3076–3078). ×2
- Fotos más nítidas: 1600 px y 82 % por Wi-Fi, Wi-Fi Direct o internet; 1280 px por solo Bluetooth (antes 800 px y 65 %) (usuarios 17-11; 3170, va en la APK siguiente a la 3080). ×1

**En prueba del dueño (rama, APK 3072)**
- Nota de voz: mantener y soltar envía; deslizar a la izquierda cancela (3143, 3145). ×1
- Deslizar sobre un mensaje para responder, con la cita en la barra (3143). ×1
- «Ocultar el texto en los avisos» por chat (3144). ×1
- Avisos de Mis estados (3141/3142). ×1
- Foto de perfil al día y sin copias (3028, 3129). ×1

**Falta**
- Visor de fotos: deslizar entre fotos y vídeos del chat, deslizar arriba/abajo para cerrar, sin «X» (dueño 16-11; en curso, 3159). ×1
- Mandar varias fotos eligiendo cuáles van de «ver una vez» (ojo en la esquina; dueño 16-11; hecho 3160; el dueño decidió dejar la pantalla «Antes de enviar» también para quien no usa el ojo: un toque). Después: «ver una vez» también para vídeos (dueño 16-11). ×1
- Texto del mensaje en el aviso con la app cerrada (llave en el Keystore; aprobado; PENDIENTES 15-11 noche «anti-suplantación»). ×2
- Punto de encuentro sin señal («¿dónde están?»), para EDC (plan, etapa 4). ×2
- Buscador en todos los chats (hoy solo dentro de un chat). ×1
- Foto del contacto como icono grande en el aviso (COLA_DE_PULIDO B2). ×1
- ¿Abrir el chat desde el aviso manda el «leído» de lo que ya estaba? Sin confirmar (PENDIENTES 13-11, puente). ×1
- Adjuntos de grupo por Bluetooth de más de ~1 MB (robustez.json «grupos»). ×1
- Fotos con la cámara del propio teléfono (modo noche y su calidad; dueño 17-11, opción A): «Cámara» abre la del teléfono, vuelve a «Antes de enviar» con el ojo; la de NEXO queda para vídeo. En curso, 3171. ×1

**Espera decisión del dueño**
- Vídeos de TikTok/Instagram/Facebook (dueño 16-11): propuesta (1) enlaces tocables con tarjeta del sitio, abre en su app; (2) NEXO en el menú «Compartir» de Android (nativo); volver con el gesto de atrás (deslizar desde abajo es «inicio» del sistema). Después: vista previa generada por quien manda. Ver dentro de NEXO: no por ahora (inicio de sesión, abrir la seguridad de la app). ×1
- Ninguna abierta.

## 4. Llamadas — 59 %
**Hecho**
- Voz 1-a-1 por Bluetooth, Wi-Fi e internet directo (WebRTC). ×3
- Vídeo 1-a-1 por Wi-Fi e internet directo; por relés en imágenes pequeñas (3056). ×3
- Llamada del sistema (Telecom / ConnectionService): con la app cerrada, en el coche (base 2882). ×3
- Llamadas y videollamadas de grupo: malla, agregar, «No contestó», invitados a destiempo (2839–2857, 3100, 3106). ×3

**En prueba del dueño**
- APK 3075: agregar a una videollamada sin cortar el vídeo (3152), llamada minimizada en una barra y de voz a vídeo sin colgar (3155), aguanta el cambio de Wi-Fi a datos (3156), «Pantalla de …» en la de grupo (3157). ×1
- Dos llamadas a la vez: espera, «Mensaje», pantalla dividida (3101–3104). ×2
- Compartir pantalla, partes 1–3 (3054–3056). ×2
- Tono «tuuu» del teléfono al llamar (3134, APK 3071). ×1
- Llamada y videollamada con el mismo estilo, también la de grupo (3141, rama). ×1
- Contestar con manos libres Bluetooth en Xiaomi: aviso hecho, falta el diagnóstico de Jhonnatan (3134). ×2

**Falta**
- Eco: la voz propia vuelve, sobre todo en grupo (PENDIENTES #128 punto 7). ×2
- Gasto de datos por relés: escucha nativa doble durante la llamada y cada parte por 3 relés (PENDIENTES 15-11 08:41). ×2
- Segunda llamada por la llamada del sistema con la app cerrada, «Mensaje» desde la pantalla de bloqueo, una cámara para dos (PENDIENTES 15-11). ×2
- Audio: volumen y foco con otras apps (Spotify) (base 2882, CLAUDE.md). ×1
- Auricular/altavoz automático por el sensor de proximidad (#128 punto 7). ×1
- Compartir pantalla en llamada de voz y en grupo por Bluetooth (PENDIENTES 13-11). ×1
- Empezar una videollamada solo con Bluetooth (hoy solo voz; PENDIENTES 13-11 07:28). ×1
- Voz también en los silencios: sin DTX (robustez.json «llamadas»). ×1

**Espera decisión del dueño**
- «Rechazar» con la app cerrada firmado por el nativo, para que el que llama se entere al momento (§4.7).
- Llamadas por internet que caen a relés con datos móviles: sin servidor TURN propio no hay arreglo completo (espera ingresos).

## 5. Interfaz — 66 %
**Hecho**
- 5 idiomas (español, italiano, inglés, portugués de Brasil, francés), también en los avisos del teléfono (3121–3123). ×3
- Estilo unificado con la pantalla de Contactos en toda la app (3140, APK 3071). ×2
- Salón de juegos (Conecta 4, tres en raya, Tetris…). ×2
- Textos auditados, todo en «tú», chat aligerado con miniaturas (2979–2990, 2987). ×1

**En prueba del dueño**
- NEXO Touch: tick, onda y pulso al tocar, ajuste de vibración (2968; §A.21). ×2
- Ajustes en 7 secciones (3142, rama). ×1
- Textos largos de portugués y francés en los botones (plan, etapa 1). ×1

**Falta**
- Estados en su propia pantalla, deslizando ← desde Contactos (dueño 17-11: solo gestos, sin botones ni pestañas; un aviso de texto la primera vez); después ahí irán el stream y los vídeos públicos, separados de lo de contactos. Hecho 3169 (va en la APK siguiente a la 3079). ×1
- Bienvenida ≤ 40 s (introducción, foto, retrato vivo, firma viva, huella), oculta tras una bandera (dueño 16-11). ×2
- Quitar los avisos de camino («por Bluetooth», «conectado/en línea por…») en la app terminada (dueño 16-11). ×1
- NEXO Touch parte 2: áreas de toque en hojas, cámara y juegos; diagnóstico del motor de vibración. ×1
- Asistente de batería de un toque al instalar (plan, etapa 2). ×1

**Espera decisión del dueño**
- Logo y sonidos (ya rechazó un logo dos veces; COLA_DE_PULIDO C).
- Cambio de nombre (16-11, nombre en estudio: Ecco/Eko): inventario del logo revisado. Se basa en la «N» y cambia en:
  ícono adaptativo + PNG antiguos (`ic_nexo_foreground`, `mipmap-*/ic_launcher*`), arranque (`ic_splash_logo`), aviso
  (`ic_stat_message`, silueta blanca), cabecera de Contactos (`src/assets/nexo_logo.png`, el único con «NEXO» escrito),
  estampa `stickers/nexo.png` (ya oculta) y gesto «N» + nombre del juego «Defensor NEXO». Se conservan círculo y colores
  del dueño; solo cambia la letra. Textos: ~96 «NEXO» por idioma + `app_name`. Antes de publicar: decidir si cambia
  `com.nexo.app` (no se puede cambiar tras publicar; los probadores reinstalarían). El prefijo «NX» del ID no se toca sin
  el dueño. Peso muerto: `src/assets/logo.png` (red de círculos, 1,7 MB ×2 en `dist`) nunca se muestra (`#splash-logo`
  no existe en la página): quitarlo en la próxima APK.

## 6. Negocio y dinero — 23 %
Detalle en el repositorio privado (`nexo-private/AREAS_PRIVADAS.md`).

## 7. Publicación — 25 % (28 % sin iPhone)
**Hecho**
- Actualizador automático para probadores, con las novedades de cada versión (2986, 3105, 3107, 3110). ×2
- NOVEDADES en 5 idiomas y flujo de lanzamiento. ×1
- Diagnóstico automático, resumen diario y canal directo a Claude (2974, 2989, 2993). ×2
- Licencia «Todos los derechos reservados» y documentos privados en su repositorio (15-11). ×1

**En prueba del dueño**
- Enlace de invitación desde «Agregar» (WhatsApp, TikTok, «Más»; 3129). ×2

**Falta**
- Apuntar a un Android más reciente (hoy targetSdk 34; Play pide 35/36) y probarlo (ESTADO 15-11, META). ×2
- Versión de tienda sin actualizador propio ni permiso de instalar apps. ×2
- Permisos delicados justificados y quitar los que sobren. ×2
- Política de privacidad, términos y formulario de seguridad de datos (con el diagnóstico). ×2
- Prueba cerrada de 14 días con al menos 12 personas, desde mediados de diciembre. ×2
- Ficha de la tienda en 5 idiomas: textos, capturas, icono, vídeo. ×2
- Diagnóstico escondido en la versión de Play, vivo por detrás (dueño 16-11). ×1
- Firma de publicación con la llave del dueño (Play App Signing). ×1
- Página web del enlace de invitación (PENDIENTES 15-11 noche). ×1
- Invitar con un motivo fuerte: propuestas (dueño 16-11). ×1
- Paso a producción. ×1
- iPhone: espera a que NEXO dé ingresos (dueño 16-11). ×3

**Espera decisión del dueño**
- Cuenta de desarrollador de Google Play (antes del 15-12). ×1 en el cálculo.
- Nombre en la tienda: hay una marca «Nexo» registrada (PENDIENTES ⭐ punto 7). ×1 en el cálculo.
- Dónde va la página del enlace de invitación (su GitHub, gratis, o dominio propio).
- ¿Se acepta sola una invitación que trae un código válido mío? (PENDIENTES 15-11 noche).
