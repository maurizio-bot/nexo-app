# NEXO — Cola de pulido (tareas pequeñas para cuando el dueño no está)

Pedido del dueño (10-11-2026): «empezar a revisar pendientes para afinar la aplicación y limpiar pequeños detalles más
estéticos; cosas que me puedas dejar como actividades cuando no tengo tiempo de atenderte». Esta lista es esa cola.

## Cómo se trabaja la cola
- Claude toma **solo los de la sección A**, en orden, cuando el dueño dice «sigue con la cola».
- Cada tarea sigue el método de siempre: prueba en el simulador (o en Chromium con tamaño de teléfono), batería completa en
  verde, commit a `NEXOCHAT`, nota en `ESTADO.md` y una o dos pruebas cortas para el dueño.
- **No se tocan** en modo autónomo: cifrado, Bluetooth de bajo nivel, firma, pagos ni nada nativo que no se pueda probar sin
  teléfono. Si algo falla o se vuelve grande, se detiene y se deja una nota en lugar de seguir.
- Para lo visual, Claude puede abrir la app en un Chromium real (el simulador `browser.js` / `calls_browser.js` ya lo hace),
  sacar capturas de pantalla del tamaño de un teléfono y revisarlas. Las que valgan la pena se las muestra al dueño.
- El dueño puede **agregar tareas con una sola línea** al final de la sección A.

## A. Autónomas (no necesitan teléfono)
| # | Tarea | Tamaño | Cómo se comprueba |
|---|---|---|---|
| A1 ✅ | **Textos sueltos** (hecho en la build 2979, 10-11; ver abajo): buscar textos fijos que no pasan por el traductor, o cortados, o en inglés dentro del español (el dueño lo pidió en la ronda 2771) y revisar que las claves nuevas de esta semana existan en español, italiano e inglés | S–M | Un script que lista textos fuera de `t()` y claves que faltan en algún idioma; la batería |
| A2 ✅ | **Capturas de las pantallas principales** (lista de contactos, chat, Perfil, Ajustes, Agregar, llamada) en Chromium con tamaño de teléfono; buscar desalineaciones, textos cortados, contraste bajo, botones muy juntos | M | Informe con capturas y lista de hallazgos; se corrigen los claros |
| A3 | **Insignia en el icono de Perfil** cuando llega un diagnóstico nuevo a la bandeja (sigue de la 🩺 de `PENDIENTES.md`) | S | `autodiag.js` ampliado |
| A4 | **Fotos HD perezosas al abrir un chat:** pintar con la previa y cargar el HD al tocar (hoy cada foto grande se lee del disco, unos 450 ms cada una) | M | Prueba de carga del chat en Chromium; contar lecturas |
| A5 | **Borrar un sticker propio** desde el selector (la función `removeUserSticker` ya existe, falta el botón) | S | Prueba del selector |
| A6 | **Pasada «usuario nuevo» por Perfil y Ajustes:** orden de las secciones, nombres claros, nada duplicado (con capturas de A2) | M | Capturas antes y después |

## B. Necesitan el teléfono del dueño (se dejan preparadas)
| # | Tarea | Qué hace falta del dueño |
|---|---|---|
| B1 | **#89 notificación que solo muestra el iconito** (sin contenido ni aviso emergente) | Diagnóstico con líneas `[ENERGIA]` y reinstalar la app para recrear el canal |
| B2 | **Foto del contacto como icono grande en las notificaciones** (nativo) | Ver una notificación real |
| B3 | **Pruebas §A.29 y §A.30** de `PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md` (se pueden hacer con un solo teléfono) | 10 minutos del dueño |

## C. Esperan una decisión del dueño
- **Logo y sonidos** (mandados al dueño para que juzgue; no se despliega sin su OK, ya rechazó un logo dos veces).
- **Diagnóstico automático:** encendido por defecto o apagado con una pregunta única (importante antes de darle la app a
  probadores externos).
- **Búsqueda de marca** de «Nexo» (empresa de criptomonedas con marcas registradas) antes de Google Play.

## Hecho
- **A1 (10-11, modo adelanto, build 2979):** `tests/sim/i18n_audit.js` (ahora en la batería, `I18NAUDIT`) revisa que toda clave usada con
  `t()` exista en la tabla con español, italiano e inglés. Encontró **60 textos sin traducir** (Estados, menú de juegos, datos y fondo de
  pantalla del Perfil, fondos por chat, tarjeta de archivo pendiente, Tetris) que en italiano e inglés salían en español; se agregaron.
  La frase armada por partes de la galería (`Hasta N a la vez…`) pasó a un marcador `{n}`. Las 16 traducciones iguales al español que
  marca la auditoría son palabras iguales en los idiomas (Foto, Error, Stickers…), correctas. Hay 25 claves de la tabla que nadie usa
  (se dejan).

- **A2 (10-11, build 2980):** `ui_shots.js` ya salta nombre y bienvenida y saca 15 capturas. Sin textos cortados ni botones montados. Arreglado: enlaces del Perfil pegados y 5 textos fijos de Agregar contactos. **Pendiente (A1b):** la auditoría solo ve `t()`; revisar textos fijos en español dentro de `src/ui` (se encontraron en `ble_ui.js`/`ble_privacy.js`; puede haber más). Voseo visible: «vos elegís» en Perfil (D2).

## Decisiones nuevas que salieron de las tareas
- **D2 (para el dueño): ¿en qué español van los textos de la app?** Hoy se mezclan «tú» y voseo: 39 formas (seguí, abrí, tocá, podés,
  tenés, escribí, mandá, elegís, vos…) en 23 archivos. Opciones: **A.** todo a «tú» neutro (Claude lo cambia y la batería lo
  comprueba); **B.** dejarlo como está. Recomendación: A, porque el dueño escribe con «tú» y una app con dos tratos se nota. Si se
  espera, queda B.

