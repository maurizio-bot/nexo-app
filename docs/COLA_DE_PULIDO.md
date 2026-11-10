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
| A1 | **Textos sueltos:** buscar textos fijos que no pasan por el traductor, o cortados, o en inglés dentro del español (el dueño lo pidió en la ronda 2771) y revisar que las claves nuevas de esta semana existan en español, italiano e inglés | S–M | Un script que lista textos fuera de `t()` y claves que faltan en algún idioma; la batería |
| A2 | **Capturas de las pantallas principales** (lista de contactos, chat, Perfil, Ajustes, Agregar, llamada) en Chromium con tamaño de teléfono; buscar desalineaciones, textos cortados, contraste bajo, botones muy juntos | M | Informe con capturas y lista de hallazgos; se corrigen los claros |
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
