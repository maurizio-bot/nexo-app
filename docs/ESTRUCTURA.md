# Estructura del código de la app (ronda 2752)

Reestructuración pedida por el dueño ("con mucho cuidado de no romper nada"): `src/main.js` (4.281 líneas) y
`src/ui/ble_interface.js` (3.732) se repartieron en módulos por tema. **El código no cambió**: cada función se movió
con su texto exacto (comprobado con `tests/sim/same_text.py` en cada paso) y nada quedó sin definir
(`tests/sim/undef.js`, también en GitHub). Batería completa sin cambios tras cada tanda.

## Punto de entrada
- `src/main.js` (720): arranque de la app, escuchas de eventos (mensajes recibidos, archivos completos, estados,
  notificaciones), `_handleIncomingMessage` y el pegamento que da a algunos módulos lo que necesitan de él.

## Chat (antes en main.js)
| Archivo | Qué hace |
|---|---|
| `ui/chat_format.js` | NEXO ID normalizado, chat abierto, tipo de mensaje, texto plano y vista previa, nombres, estados |
| `ui/chat_state.js` | a qué contacto pertenece cada mensaje enviado |
| `ui/render.js` | dibujar cada burbuja, estados ✓/✓✓, historial por páginas, progreso de archivos que llegan |
| `ui/send.js` | enviar texto y adjuntos por el mejor camino |
| `ui/chat_actions.js` | menú de la burbuja: responder, reenviar, copiar, eliminar; barra de respuesta |
| `ui/chat_nav.js` | abrir/cerrar el chat, botón atrás, deslizar para volver |
| `ui/e2e_banner.js` | aviso de cifrado del chat y verificación con QR |
| `ui/file_card.js` | tarjeta de archivo, abrir archivos, miniaturas, pantalla completa |
| `ui/file_tools.js` | extensión/MIME, PDF, iconos, tamaños, leer en base64, comprimir fotos, hora |
| `ui/pickers.js` | elegir foto de la galería o un archivo |
| `ui/camera.js` | cámara: foto, vídeo, linterna, revisión antes de enviar |
| `ui/video_tools.js` | previa 240p, miniatura, Blob ↔ base64 |
| `ui/video_send.js` | enviar vídeo: previa y HD, reanudar el HD, cambiar previa por HD |
| `ui/media_limits.js` | límites por Bluetooth y Wi-Fi Direct, liberar URLs de vídeos/imágenes |
| `ui/voice.js` | notas de voz |
| `ui/location.js` | enviar la ubicación |
| `ui/share_contacts.js` | compartir contactos y su tarjeta |
| `ui/profile.js` | Perfil y avisos de Fénix |
| `ui/diag.js` | registro de diagnóstico (Perfil → Copiar diagnóstico) |
| `ui/ui_bits.js` | avisos en pantalla, menú de adjuntar, piezas pequeñas |
| `ui/app_setup.js` | preparar la interfaz: cuadro de texto, cabecera, botones, pantalla de permisos |
| `ui/notify.js` | no leídos y notificaciones (ronda 2751) |

## Bluetooth y caminos (antes en ble_interface.js)
`ble_interface.js` (847) conserva la clase `BLEInterface` con lo central (constructor, arranque, escuchas nativas,
estados, `openChat`, resolver el camino de cada contacto, cerrar). El resto de métodos está en módulos y se añade a la
clase con `Object.assign(BLEInterface.prototype, …)` (mismo `this`, mismos nombres):
| Archivo | Métodos |
|---|---|
| `ui/ble_helpers.js` | funciones auxiliares (vault de contactos y NEXO ID, ids `lan:`/`net:`, llamadas seguras al plugin, eventos) |
| `ui/ble_messages.js` | lo que llega (`_prePayload`, `_handlePayload`) y lo que sale (`sendChatMessage`, `sendFile`, pendientes) |
| `ui/ble_connections.js` | supervisor, pings, reconexión, teléfonos encontrados, esperar enlace listo |
| `ui/ble_keys.js` | intercambio y cambio de claves, remitente sellado, poscuántico, verificación |
| `ui/ble_links.js` | enlaces Wi-Fi e internet, `linkOf` |
| `ui/ble_contacts.js` | no leídos, último mensaje, contactos compartidos |
| `ui/ble_ui.js` | panel, lista de chats, franja de en línea, menú de contacto, insignia |
| `ui/ble_jump_send.js` | envíos por Jump |
| `ui/ble_camera_pause.js` | pausa del Bluetooth con la cámara abierta |
| `ui/ble_privacy.js` | ID rotativo (ronda 2756): qué se anuncia (NEXO ID visible o código) y traducir los códigos de los contactos |

Ronda 2756: `ui/ble_rid.js` (cálculo del código rotativo; igual que `RidToken.kt`) y `ui/big_file.js` (archivos grandes:
trozos a disco, paso por Wi-Fi / Wi-Fi Direct, estado de la tarjeta; nativo en `BigFile.kt`).

Ronda 2757: `BgInbox.kt` (nativo): con la app cerrada, qué se guarda en el buzón, qué se confirma y qué se avisa;
lo usa `NexoBlePlugin.kt` (closedReceive / takeOverFromClosed).

Ronda 2758: `ui/groups.js` (chats de grupo: almacén `nexo_groups.json`, sobre `nexo_grp`, envío a cada miembro y
estado conjunto) y `ui/groups_ui.js` (botón 👥, hoja para crear, abrir el chat del grupo, menú). `bleInterface.groups`.
Llamadas de voz: `ui/calls.js` (señalización, cifrado y estados; `bleInterface.calls`), `ui/call_media.js` (micrófono,
Opus/μ-law, reproducción) y `ui/calls_ui.js` (botón 📞, pantalla de llamada, línea en el chat).
Ronda 2759: `ui/move_account.js` (pasar la cuenta a un teléfono nuevo: QR, progreso, pantallas) y `AccountMove.kt`
(empaquetar / desempaquetar / borrar; lo usan `moveReceive` y `moveSend` de `NexoBlePlugin.kt`).

Sin cambios: `ui/ble_ack.js` (protocolo de trozos), `ui/ble_relay.js` (Jump), `ui/lan.js`, `ui/wifi_direct.js`,
`net/net_link.js` (internet), `vault/*`, `fenix/*`.

## Herramientas para mover código sin romperlo (`tests/sim`)
- `undef.js`: nombres usados sin definir en lo que entra en la APK (también en GitHub).
- `group_deps.js`: qué usa un grupo de funciones del resto del archivo y quién lo usa.
- `extract.js` / `extract_methods.js`: mueven funciones/variables o métodos de clase con su texto exacto; se niegan a
  mover una variable que el resto modifica (un import no se puede reasignar).
- `same_text.py`: lo quitado del origen es exactamente lo que está en el módulo (salvo `export`, cabecera, comas entre
  métodos y el `[pegamento]` marcado).
- `add_glue.py` / `auto_import.py`: imports de un módulo nuevo y el pegamento con main.js.
