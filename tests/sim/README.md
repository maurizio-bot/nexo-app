# Simulador de dos teléfonos

Ejecuta el bundle web **real** de la APK en dos "teléfonos" (jsdom) unidos por `native_mock.js`,
una réplica de `plugins/nexo-ble/.../NexoBlePlugin.kt` (campos que lee cada método, troceo por MTU,
reensamblado JSON de `processReceivedChunk`, eventos y su orden).

```bash
cd tests/sim && npm install          # una vez (jsdom)
./build.sh            # compila el árbol de trabajo en builds/wip
node run.js builds/wip --content-fallback
./build.sh 04960e2 && node run.js builds/04960e2   # comparar con otra versión
```

Escenario (todo por la interfaz: botones, input, menú de adjuntos):
1. A busca a B y lo añade; A abre el chat y envía un texto corto y uno largo (>180).
2. B abre el chat y responde; A envía otro con el chat de B abierto (debe llegar a "leído").
3. A envía un archivo (misma transferencia que las fotos).
4. B y A cierran y reabren el chat: el historial guardado debe mostrar todo con su estado.
5. B se aleja, A escribe, B vuelve: debe llegar una sola vez.
6. B se aleja, A escribe y **reinicia la app**, B vuelve: debe llegar y guardar su estado.

`perf.js` mide adjuntos: dos fotos (~60 KB base64), textos después y un PDF. Informa tiempos, piezas
enviadas, descartes de la cola nativa (500), escrituras a disco y lag del hilo. Opciones:
`--mtu=247`, `--mtu=23`, `--loss=0.03`, `--pdf-kb=400`, `--pace=15,15` (ms por escritura
servidor,cliente). Desde la 2693 el nativo envía la siguiente escritura cuando Android confirma la
anterior (`onNotificationSent` / `onCharacteristicWrite`); `--pace` modela cuánto tarda la radio en
confirmar (15 ms ≈ buen enlace, 30 ms ≈ enlace lento). Cola de 500 como el nativo. También comprueba
el progreso visible ("○ N%" en A, "Recibiendo… N%" en B).

`lifecycle.js` reproduce "cierro/pongo en segundo plano la app de B, A escribe, B la reabre":
`node lifecycle.js builds/wip --retain --close-no-service --asymmetric --seq-b=500 --js-delay=6000`.
`--retain` = el nativo guarda los mensajes hasta que el JS escucha (como `notifyListeners(..., true)`),
`--close-no-service` = cierra la conexión cuando el otro no tiene servidor GATT, `--asymmetric` =
direcciones distintas al anunciar y al conectar (Android), `--js-delay` = lo que tarda el WebView en
arrancar. Sin `--retain` reproduce la pérdida de la 2691 (eventos sin oyente descartados).
`--io-delay=25` añade la latencia real de leer/guardar archivos por el bridge (sin ella el historial
nunca mostraba carreras).

`background.js` (desde la 2695): `--scenario=bg` (B en segundo plano, se cae el enlace, vuelve),
`--scenario=closed` (B cierra y reabre), `--scenario=repeat` (mismo texto varias veces). Opciones de
radio realista: `--io-delay=25`, `--rotate` (dirección nueva al reabrir), `--scan-miss=0.3`,
`--supervision=8000` (el otro tarda en notar la caída), `--a-bg` (A también oculta),
`--app-events` (Kotlin nuevo avisa onResume/onPause), `--no-m3` (A no vuelve a escribir),
`--off=660000` (11 min fuera). Con la app oculta, un escaneo sin filtro no da resultados.

La línea `RESULTADO` resume cada comprobación. Los logs de ambos teléfonos quedan en `last_logs_*.txt`.

Límites: no simula la radio real (alcance, interferencias, direcciones aleatorias de Android entre
escaneo y conexión), ni la cámara/canvas, ni el código Kotlin en sí (solo su comportamiento).

`contacts.js` (tres teléfonos): orden de la lista por último mensaje; `--churn` añade actividad de
radio (reconexiones) para comprobar que no salta. `video.js`: vídeo previa + HD automático con una
previa simulada (jsdom no tiene MediaRecorder); `--cut` corta el enlace a mitad del HD, `--restart-a`
cierra y reabre la app del emisor, `--orig-kb=2000 --preview-kb=140` tamaños.

`browser.js`: los dos teléfonos en **Chromium real** (Playwright, ya instalado en el contenedor) con la
radio simulada en Node (`native_mock.js` por un puente). Aquí sí funcionan `<video>`, canvas,
MediaRecorder, WebAudio y blob URLs: graba un clip real de 5 s, lo envía con la previa real, miniatura y
HD, y abre el visor varias veces contando los reproductores que quedan vivos (en Android cada uno retiene
un decodificador). Opciones: `--closed` (B cerrada al enviar), `--no-preview` (fuerza el plan B),
`--views=3`. `node browser.js builds/wip --closed`. Lo que NO cubre: el WebView de Android en sí
(decodificadores de hardware, H.264, AudioContext sin gesto): para eso, Perfil → Diagnóstico en el
teléfono.

`share.js` (tres teléfonos): A comparte el contacto C con B (botón contacto del menú de adjuntos); B
pulsa la tarjeta, C aparece parpadeando en su lista y B le escribe aunque nunca se habían conectado.
`--c-away`: C fuera de alcance al escribirle (el mensaje espera en cola y llega al encontrarlo).
Nota: las pruebas esperan hasta 40 s a emparejar (con mucha carga de CPU 10 s no bastaban) y
`background.js` avisa si no pudo emparejar en vez de dar un resultado engañoso.

Rendimiento (Chromium real, `pw_harness.js`): `stress.js` mide por fases (reposo, ráfaga, multi-chat,
fotos, vídeo, abrir historial grande) el lag del hilo de la interfaz, tareas largas, CPU (CDP) y
memoria, con la CPU frenada (`--cpu=4`, como un teléfono de gama media). `profile.js` da el tiempo
de CPU por función del receptor. Comparar builds: `./build.sh <commit>` y la misma prueba en cada una.

Cifrado de extremo a extremo (las pruebas jsdom usan el WebCrypto de Node: `installWebCrypto`):
`e2e.js` captura todo lo que pasa por la "radio" y comprueba que ningún contenido (texto corto, largo,
archivo, nombre y miniatura del vídeo) viaja en claro, que todo llega descifrado e intacto, que se
intercambian las claves y el aviso cuando B reinstala (clave nueva). `mixed.js builds/wip
--old=builds/<commit>`: actualización a medias (B con una build sin cifrado): lo de A espera sin salir en
claro, lo de B llega, y al actualizarse B llega lo pendiente. `resend.js`: un texto largo o archivo ya
entregado no se vuelve a enviar al reconectar ni al reiniciar la app; `--upgrade=builds/wip` arranca A
con otra build sobre los mismos archivos (limpieza de lo que dejó la anterior).
