# NEXO — Comparativa con la competencia y estado de avance

Hecha el 24-10-2026 (build 2763); **actualizada el 28-10-2026 (build 2820)** con lo nuevo desde entonces: despertador
FCM tipo WhatsApp (#87), archivos grandes por internet (~22 MB), Estados (Stream fase 1), buscar en el chat, cobros,
y la auditoría severa del 28-10. Los datos de NEXO salen del código y del simulador; los de la competencia, de sus
páginas y noticias (enlaces al final). Lo que no se pudo confirmar va marcado con "?".

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

## 1bis. Puntuación (índice de robustez, 28-10-2026, build 2820)

Medido con `tests/sim/robustez.js` sobre la batería (75/75 verde) y el catálogo `robustez.json`. De 0 a 100, por área
y ponderado por peso. **Índice global: 43,1/100.**

| Componente | Puntos | De | Qué mide |
|---|---|---|---|
| A — Pruebas | 24,3 | 35 | Fallos conocidos vigilados por una prueba automática que pasa. **Alto**: el código está bien cubierto. |
| B — Teléfonos | 6,8 | 35 | Confirmado en teléfonos reales tras el último cambio del área. **Muy bajo**: casi nada probado desde la 2765. |
| C — Puntos débiles | 9,3 | 20 | 20 menos lo que resten los débiles abiertos (grave −8, medio −4, leve −2). |
| D — Estabilidad | 2,7 | 10 | Áreas revisadas a fondo hace poco. |

**Lectura honesta:** NEXO tiene MÁS funciones que cualquier rival offline y cifrado al nivel de Signal, pero el índice
se queda en ~43 por una sola razón: **B (confirmación en los teléfonos) está en 6,8 de 35**. El código y el simulador
están sólidos (A alto); lo que falta es **probar en los teléfonos reales**. Es, con diferencia, lo que más subiría la
nota, y es lo único que no puedo hacer yo. Si confirmas unas pocas áreas en los dos teléfonos, el índice sube a ~55–65
(ya estimado el 25-10). La seguridad mejoró esta tanda (sube la cobertura con SEC-1/SEC-4), pero quedan 7
endurecimientos de protocolo abiertos (H3/H4/M5/M6/F6/F7/F8) para rondas propias, varios a confirmar contigo por tocar
el estado de claves.

## 2. Estado de avance

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
