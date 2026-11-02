# NEXO — Comparativa con la competencia y estado de avance

Hecha el 24-10-2026 (build 2763); **actualizada el 02-11-2026 (build 2886)**. Nuevo desde la 2820: **llamada entrante Y
saliente integrada al sistema** (ConnectionService/Telecom, como WhatsApp/Signal: aparece en el coche/auriculares/reloj
y se cuelga desde ahí), **volumen de llamada + foco de audio** (la música vuelve solo al colgar), **stickers propios**
(foto + texto/emoji arrastrables), **tres idiomas** (es/it/en), **arranque limpio** (sin el splash feo), y un arreglo
clave de **envío de archivos** (al caer el Wi-Fi/MTU 23 el archivo ya no se marca «fallido»: queda pendiente y se
reenvía solo). Antes (2820): despertador FCM (#87), archivos grandes por internet (~22 MB), Estados, buscar en el chat,
cobros, auditoría severa. Los datos de NEXO salen del código, el simulador y las pruebas del dueño; los de la
competencia, de sus páginas y noticias (enlaces al final). Lo que no se pudo confirmar va marcado con "?".

## 1. Comparativa

| Función | NEXO | WhatsApp | Signal | Briar | bitchat | Bridgefy |
|---|---|---|---|---|---|---|
| Sin internet (Bluetooth) | ✅ | ❌ (archivos cerca: beta 2024, sin confirmar) | ❌ | ✅ | ✅ | ✅ |
| Malla multi-salto | ✅ Jump (8 saltos, guarda 24 h) | ❌ | ❌ | ❌ | ✅ (7 saltos) | ✅ |
| Wi-Fi local / Wi-Fi Direct | ✅ / ✅ | ❌ | ❌ | ✅ / ❌ | ? | ❌ |
| Internet cuando hay | ✅ relés Nostr + Tor (Tor: arreglo 2766 sin confirmar) | ✅ | ✅ | ✅ Tor | ✅ Nostr | ✅ |
| Archivos grandes por internet | ✅ ~22 MB (Tor directo o relés; >22 MB espera Wi-Fi/WD, con aviso claro) | ✅ | ✅ | ? | ? | texto |
| Despertar con la app cerrada horas (push) | ⏳ FCM listo (Fase 1+2), falta desplegar el enviador | ✅ FCM/APNs | ✅ FCM/APNs | ❌ (servicio vivo) | ❌ | ? |
| Elige el camino solo | ✅ (regla del dueño) | — | — | parcial | parcial | parcial |
| Fotos, vídeo, archivos sin internet | ✅ hasta 1 GB, vídeo HD | ❌ | ❌ | fotos | ? | texto |
| Llamadas de voz sin internet | ✅ Bluetooth / Wi-Fi (Bluetooth lento: voz con segundos de retraso, pendiente) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Videollamadas sin internet | ✅ mismo Wi-Fi | ❌ | ❌ | ❌ | ❌ | ❌ |
| Llamada integrada al sistema (coche/auriculares/reloj, colgar desde ahí) | ✅ Telecom self-managed, entrante+saliente (2880/2882) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Idiomas | ✅ 3 (es/it/en, sigue el teléfono) | ✅ muchos | ✅ muchos | ✅ varios | ? | ? |
| Grupos | ✅ | ✅ | ✅ | ✅ | ✅ canales | difusión sin cifrar |
| Cifrado | Double Ratchet + poscuántico + remitente oculto (suplantación por un teléfono cercano: arreglada en la 2768) | Signal | referencia | ✅ (auditado 2017) | Noise (sin auditoría al lanzar) | críticas 2020–21 |
| ID Bluetooth que cambia (no te rastrean) | ✅ | — | — | — | efímero | ? |
| Recibir con la app cerrada | ✅ Bluetooth e internet (servicio vivo); despertador FCM en camino para el caso «congelada horas» | ✅ | ✅ | servicio fijo | ? | ? |
| Copia de seguridad | ✅ Fénix (en tus contactos, sin servidor) | nube | sí | ❌ | ❌ | ❌ |
| Sin número de teléfono | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| iPhone | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| En tiendas (Play Store) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Auditoría externa / uso a gran escala | ❌ / ❌ | ✅ | ✅ | ✅ / pequeño | ❌ / medio | pequeño |
| Foto de perfil | ✅ (2766) | ✅ | ✅ | ✅ (desde 2021) | ? (nombre o "anon") | ? |
| Estados / buscar en los chats | ✅ Estados (cercanos, E2E, 24 h) / ✅ buscar en un chat (falta global) | ✅ / ✅ | ✅ / ✅ | blogs / ? | ? | ? |
| Cobros (mensajería de cobros, sin tocar el dinero) | ✅ (alias/CBU/QR, sin licencia) | pagos nativos (según país) | ❌ | ❌ | ❌ | ❌ |

Corrección respecto a la versión anterior de esta tabla: Briar sí tiene foto de perfil (versión 1.3, 2021); en bitchat
y Bridgefy no se pudo confirmar (antes ponía ❌).

**Dónde gana NEXO:** es la única que junta todos los caminos (Bluetooth, Wi-Fi, Wi-Fi Direct, L2CAP, internet, Tor
y Jump) y cambia sola; la única que hace llamadas y videollamadas sin internet; archivos grandes y vídeo HD sin
internet; cifrado al nivel de Signal y con poscuántico; copia de la cuenta sin servidores (Fénix).

**Dónde pierde (puntos débiles):** solo Android y fuera de las tiendas; **muy pocas pruebas reales en teléfonos** (es el
mayor hueco: casi nada confirmado desde la build 2765, ver la puntuación abajo); auditoría solo interna (propia, con
revisores adversariales), no externa; consumo de batería en segundo plano sin medir; el despertador FCM «como WhatsApp»
está listo en código pero **falta desplegar el enviador** (lo hace el dueño con su cuenta); voz con segundos de retraso
por un Bluetooth lento (teléfonos viejos); llamada/videollamada por internet aún no (solo en local); falta el buscador
global y iOS.

**Qué cambió en esta tanda (builds 2816→2820, 28-10):** (1) **Despertador FCM tipo WhatsApp (#87)** — Google solo lleva
un «toque» sin contenido (el mensaje sigue P2P y cifrado); código de Fase 1+2 listo y probado en el simulador, falta que
el dueño despliegue el enviador. (2) **Archivos grandes por internet** hasta ~22 MB (antes ~6 MB) y nunca «enviada» en
silencio. (3) **Diagnóstico** acotado a 30 min y ~5000 líneas. (4) **Auditoría severa** con dos revisores adversariales
independientes: 7 fallas reales arregladas (entre ellas una **ALTA** que dejaba sordo a internet para siempre con una
fecha falsa, y una **GRAVE** que podía cuelgar el proceso al despertar por FCM). (5) Antes, en la tanda del 27-10:
Estados (Stream fase 1), buscar en el chat, cobros, «ver una vez», guardar en galería, Face ID opcional, gesto atrás.

## 1bis. Puntuación (índice de robustez, 02-11-2026, build 2886)

Medido con `tests/sim/robustez.js` sobre la batería (104/104 verde) y el catálogo `robustez.json`. De 0 a 100, por área
y ponderado por peso. **Índice global: 54,2/100** (era 43,1 el 28-10).

| Componente | Puntos | De | Qué mide |
|---|---|---|---|
| A — Pruebas | 26,3 | 35 | Fallos conocidos vigilados por una prueba automática que pasa. **Alto**: el código está bien cubierto. |
| B — Teléfonos | 15,9 | 35 | Confirmado en teléfonos reales. **Subió de 6,8 a 15,9** al acreditar las pruebas reales del dueño (bases 2823/2858, UX 2875/2876) que no estaban anotadas en el catálogo. |
| C — Puntos débiles | 9,3 | 20 | 20 menos lo que resten los débiles abiertos (grave −8, medio −4, leve −2). |
| D — Estabilidad | 2,7 | 10 | Áreas revisadas a fondo hace poco. |

**Lectura honesta:** NEXO tiene MÁS funciones que cualquier rival offline y cifrado al nivel de Signal; el índice subió
a **54,2** al contar el testeo real del dueño (B 6,8 → 15,9). Lo que todavía lo frena es **B**: la regla da 35 por área
solo si el dueño la confirma en la ÚLTIMA build, y como se sube muy seguido, casi todo figura «cambió desde la última
prueba» (15). Si el dueño re-confirma cada área en la build de hoy, el índice sube a **~73** (calculado con el mismo
programa). A sigue alto (código bien cubierto). Quedan endurecimientos de protocolo de seguridad abiertos
(H3/H4/M5/M6/F6/F7/F8) para rondas propias, varios a confirmar con el dueño por tocar el estado de claves. Pendientes de
los diagnósticos del 02-11: el resto del envío de archivos (B2 no-martillar / B1 nativo), reconexión en ráfaga, audio
fino y chat lento al crecer (ver `docs/DIAGNOSTICO_02-11.md`).

## 2. Estado de avance

Esta tabla es un **histórico que va creciendo** (con la build en que se arregló cada cosa); para el número actual de
robustez, mirar §1bis. Las filas de abajo del todo (02-11) son lo nuevo de esta tanda.

✅ hecho / probado · ⚠️ probado en teléfonos con fallos (arreglo sin confirmar) · ⏳ sin probar en teléfonos

| Parte | Código | Simulador | Teléfonos |
|---|---|---|---|
| Escaneo y agregar | ✅ | ✅ | ⚠️ no se veía a nadie tras borrar (arreglo 2765; BUSCAR colgado, 2766) |
| Conexión Bluetooth | ✅ | ✅ | ⚠️ enlace rehecho cada 30 s (arreglo 2766: los pings no se contestaban) |
| Textos cortos y largos | ✅ | ✅ | ✅ (2713); largos pendientes que se perdían: arreglo 2767 |
| Envío al teléfono correcto | ✅ | ✅ | ⚠️ llegaba al Vivo (arreglo 2765 y 2766) |
| Fotos y archivos por Bluetooth | ✅ | ✅ | ⚠️ no llegaban (arreglo 2761; más de 10 min, 2767) |
| Archivos grandes hasta 1 GB | ✅ | ✅ | ⏳ |
| Wi-Fi Direct | ✅ | ✅ | ✅ (2713) |
| Wi-Fi misma red y camino del dueño | ✅ | ✅ | ⏳ (se perdía al volver a la app: arreglo 2766) |
| Internet por relés | ✅ | ✅ | ✅ (diagnóstico del Vivo) |
| Internet por Tor | ✅ | ✅ | ⚠️ sin dirección .onion (arreglo 2766) |
| Jump | ✅ | ✅ | ⏳ |
| Avisos en segundo plano / app cerrada | ✅ | ✅ | ⚠️ con Wi-Fi y la pantalla apagada no llegaban (informe 25-10; arreglo 2772) |
| Pantalla apagada: avisos y llamadas que la encienden | ✅ | ✅ | ⏳ (2766) |
| Cifrado de extremo a extremo | ✅ | ✅ | ✅ (suplantación cercana: arreglo 2768, sin confirmar) |
| Grupos (con HD y archivos grandes) | ✅ | ✅ | ⏳ |
| Llamadas de voz | ✅ | ✅ | ⚠️ un teléfono no oía (arreglo 2762); otros 12 fallos arreglados en la 2768; con la pantalla bloqueada, foco de audio y tono en silencio (2770, sin probar); interferencias en el micrófono (informe 25-10; filtros 2772) |
| Videollamadas (mismo Wi-Fi) | ✅ | ✅ | ⚠️ con la 2768 el S24 a veces sin cámara, negra y sin voz (informe del dueño); cámara y micrófono que se recuperan solos (2769, sin probar); imagen muy cerca y deformada, sin espejo (informe 25-10; arreglo 2772) |
| Fénix | ✅ | ✅ | ⏳ |
| Pasar la cuenta | ✅ | ✅ | ⏳ |
| Foto de perfil | ✅ | ✅ | ⏳ (2766) |
| Interfaz estilo NEXO | ✅ | ✅ | ⚠️ barra gris al girar (arreglo 2765) |
| Llamada integrada al sistema (Telecom) | ✅ | ✅ | ✅ entrante+saliente, coche OK (dueño 02-11, build 2882) |
| Volumen de llamada + foco (música vuelve al colgar) | ✅ | ✅ | ⏳ arreglo 2883 (diagnóstico «foco de audio: no») |
| Stickers propios (foto + texto/emoji) | ✅ | ✅ | ⚠️ 2882 muy transparentes; más sólidos 2883 (sin confirmar) |
| Arranque sin splash | ✅ | ✅ | ⏳ 2884 |
| Archivo que no cabe por el camino de ahora → pendiente, no «fallido» | ✅ | ✅ | ⏳ arreglo 2885 (diagnóstico del dueño) |
| Burbuja de texto que recortaba el texto | ✅ | ✅ | ⏳ arreglo 2886 |

Plan del dueño (23-10, PENDIENTES §5): puntos 1–17 hechos en código (13 L2CAP y 17 videollamadas con una segunda
fase pendiente; 15 B, varios dispositivos a la vez, para después). Faltan 18 (pruebas con 3–4 teléfonos), 19
(auditoría externa) y 20 (Play Store). Sin decidir: pagos, Stream, iPhone, núcleos.

### Porcentaje (estimación del 24-10)

| Qué se mide | Avance |
|---|---|
| Plan del dueño: funciones hechas en código y probadas en el simulador | 17 de 20 puntos: 85 % |
| Revisión completa por partes | 3 de 4 hechas (falta la interfaz): 75 % |
| Confirmado en teléfonos reales | 4 de 21 partes: ~20 % |
| Salida al público (pruebas con 3–4 teléfonos, auditoría externa, Play Store) | 0 de 3 |
| **En conjunto** (pesos: funciones 40 %, revisión 20 %, teléfonos 25 %, salida 15 %) | **~55 %** |

## Fuentes

- bitchat: [GitHub](https://github.com/permissionlesstech/bitchat), [Android](https://github.com/permissionlesstech/bitchat-android), [Wikipedia](https://en.wikipedia.org/wiki/BitChat), [TechCrunch 2025](https://techcrunch.com/2025/07/07/jack-dorsey-working-on-bluetooth-messaging-app-bitchat/), [AlternativeTo 2026](https://alternativeto.net/news/2026/8/bitchat-adds-offline-android-app-sharing-with-direct-device-transfer/), [Android Infotech oct. 2026](https://www.androidinfotech.com/bitchat-features-limitations/), [Xataka (nombre o "anon")](https://www.xatakamovil.com/aplicaciones/he-probado-bitchat-alternativa-a-whatsapp-creador-twitter-que-no-necesita-internet-diferente-que-dudo-su-futuro)
- Briar: [briarproject.org](https://briarproject.org/), [F-Droid](https://f-droid.org/de/packages/org.briarproject.briar.android/), [Briar 1.3: foto de perfil (2021)](https://briarproject.org/news/2021-briar-1.3-released/)
- Bridgefy: [bridgefy.me](https://bridgefy.me/), [TechCrunch 2020](https://techcrunch.com/2020/11/02/bridgefy-launches-end-to-end-encrypted-messaging-for-the-app-used-during-protests-and-disasters)
- WhatsApp sin internet: [TechRadar](https://www.techradar.com/computing/software/whatsapp-could-soon-get-internet-free-file-sharing-thanks-to-airdrop-style-upgrade), [Neowin](https://www.neowin.com/news/whatsapp-spotted-testing-a-new-offline-file-transfer-feature-called-people-nearby/)
- Berty (no incluida en la tabla: estado de 2026 sin confirmar): [berty.tech](https://berty.tech/pl/features)
