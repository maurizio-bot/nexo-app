# Revisión como persona externa — 26-11 (build 3156)

**Alcance real (honesto):** abrí la app compilada en un navegador de prueba con tamaño de teléfono (393×800) y recorrí lo que se ve sin
Bluetooth ni contactos: nombre, bienvenida (4 pasos), pantalla de Contactos y Ajustes. NO usé chats, llamadas, archivos, Bluetooth ni Wi-Fi
Direct reales, y NO instalé ni probé las otras apps: la comparativa sale de lo que sé de ellas, no de pruebas en vivo. Las pruebas reales las
tiene el dueño con sus teléfonos.

## Lo que me gustó
- Primer arranque limpio y corto: nombre → 4 pantallas claras («funciona sin internet», «manda tu primer mensaje»…) con «Saltar» y «Atrás».
- Tema oscuro consistente, botón principal con degradado muy legible, textos en español natural, avisos honestos (el nombre no se cambia).
- Contactos limpio: una sola acción grande (burbuja azul), buscar y Ajustes arriba como círculos.
- Ajustes ordenado por 7 grupos con icono, título y una línea que dice qué hay dentro (mejor que la lista larga de WhatsApp).
- Su promesa es única: mensajes sin internet por Bluetooth/Wi-Fi + internet + puente cuando falta uno. Ninguna de las grandes lo hace.

## Lo que no me gustó (candidatos a la auditoría de estética)
1. **Voseo argentino** en un texto de la primera pantalla: «Escribilo con atención» (`es.js` name_gate_warn). Para México: «Escríbelo». Buscar más («leé», «pedí»).
2. **Ajustes no se ve igual que Contactos:** Contactos lleva el título con degradado («Contac|tos»), círculos arriba y el avatar; Ajustes tiene
   título blanco liso, más grande, sin botón de regreso a la vista y tarjetas anchas. Mismos márgenes y mismo encabezado en todas las pantallas.
3. **Contactos vacío** deja casi toda la pantalla en negro; el texto dice «toca el botón redondo» pero las opciones de invitar (WhatsApp, TikTok,
   enlace) y «Agregar por NEXO ID» están escondidas dentro de la lista/panel. Un usuario nuevo sin contactos debería ver «Invitar» a primera vista.
4. **La burbuja azul** (buscar gente cerca) no dice qué hace ni tiene texto; el estado propio y «En línea ahora» no se entienden sin explicación.
5. **Estados por gesto escondido** («desliza a la izquierda»): no hay barra de pestañas visible; WhatsApp/Telegram muestran Chats/Estados/Llamadas.
6. **Pantalla de «Un paso para que funcione siempre»** (batería) aparece antes de que el usuario haya visto nada de la app: pide un permiso
   sin haber dado valor aún. Mejor pedirlo al primer contacto agregado o con el primer mensaje.

## Comparativa (según lo que sé de cada una)
| | NEXO | WhatsApp | Signal | Telegram | Briar / Bridgefy / Berty (sin internet) |
|---|---|---|---|---|---|
| Sin internet (Bluetooth/Wi-Fi) | **Sí, y se combina con internet** | No | No | No | Sí (Briar Bluetooth/Wi-Fi; Bridgefy Bluetooth) |
| Cifrado extremo a extremo | Sí | Sí | Sí, referencia | Solo chats secretos | Sí |
| Cuenta sin número de teléfono | **Sí (NEXO ID)** | No | Parcial (usuario) | Sí (usuario) | Sí |
| Llamadas/videollamadas, grupos, estados | Sí, aún en pulido | Muy pulido | Pulido | Muy pulido | Poco o nada |
| Archivos grandes sin internet | Sí (Wi-Fi local/Wi-Fi Direct) | n/a | n/a | n/a | Limitado |
| Pulido, estabilidad, escala | **Aún le falta** | Muy alto | Alto | Alto | Medio |
| Comunidad (¿hay con quién hablar?) | **Su mayor reto** | Todos | Muchos | Muchos | Pocos |

## Qué le falta frente a las demás (lo que un usuario echará de menos)
- **Gente:** su valor aparece cuando los dos lo tienen; sin eso el primer minuto es una lista vacía. Invitar fácil (ya hay enlace/WhatsApp) es clave.
- Respaldo/historial en la nube y multidispositivo (WhatsApp/Telegram); versión de escritorio.
- Búsqueda dentro de chats, fijar mensajes y administración fina de grupos al nivel de Telegram (confirmar qué ya existe).
- Pruebas de campo: las apps grandes funcionan en cualquier teléfono; NEXO depende del ahorro de batería de cada marca (se ve en los diagnósticos).

## Lo que me sirvió
Para quedarme sin señal (vagón, EDC, apagón) NEXO es la única de la tabla que combina caminos en una sola app con cuenta sin teléfono: ese es
su espacio. Para el resto del día WhatsApp/Signal/Telegram ganan por pulido y por tener a todos.

## Segunda y tercera revisión externa (IA del dueño, 26-11, sobre la nightly 3156) — comprobado en el código
- **Cierto y barato:** el aviso de Contactos vacío dice «Tus contactos están en Chats» pero la pantalla se llama «Contactos» (`nav_contactos`, `ble_scan_hint_off`) →
  incoherente; decidir «Chats» (o «Contactos» en los dos sitios). El símbolo del camino en el cabecera del chat NO se puede tocar (sin manejador): tocarlo
  podría explicar «Bluetooth · directo / Wi-Fi / internet / por puente». Estados sigue sin entrada visible (ahora hay destello + guía).
- **Ya estaba o ya se arregló en esta tanda:** el «+» de la guía (es.js ya decía «botón redondo»; el texto nuevo tampoco lo nombra; el botón es una burbuja);
  pantalla vacía con botón; texto del diagnóstico automático ya dice «sin el contenido de tus mensajes» (es opcional y cifrado), solo está redactado técnico.
- **Decisión del dueño (no se toca sin él):** nombre fijo para siempre (anti-suplantación) vs. poder cambiarlo avisando a los contactos; orden del
  permiso de batería (hoy al final de la guía); etiquetas de texto en el menú de adjuntos (no verificado aquí).
- **No aplica por ahora:** «agregar más» (las dos dicen lo mismo: no más funciones antes de Play); rediseño del estilo visual (el dueño aprobó el actual).
