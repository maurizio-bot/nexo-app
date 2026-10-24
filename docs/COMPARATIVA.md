# NEXO — Comparativa con la competencia y estado de avance

Hecha el 24-10-2026 con la build 2763; actualizada el mismo día con la 2767 publicada y la 2768 (llamadas) en curso.
Actualizar cuando cambie algo importante. Los datos de NEXO salen del código y del simulador; los de la competencia,
de sus páginas y noticias (enlaces al final). Lo que no se pudo confirmar va marcado con "?".

## 1. Comparativa

| Función | NEXO | WhatsApp | Signal | Briar | bitchat | Bridgefy |
|---|---|---|---|---|---|---|
| Sin internet (Bluetooth) | ✅ | ❌ (archivos cerca: beta 2024, sin confirmar) | ❌ | ✅ | ✅ | ✅ |
| Malla multi-salto | ✅ Jump (8 saltos, guarda 24 h) | ❌ | ❌ | ❌ | ✅ (7 saltos) | ✅ |
| Wi-Fi local / Wi-Fi Direct | ✅ / ✅ | ❌ | ❌ | ✅ / ❌ | ? | ❌ |
| Internet cuando hay | ✅ relés Nostr + Tor (Tor: arreglo 2766 sin confirmar) | ✅ | ✅ | ✅ Tor | ✅ Nostr | ✅ |
| Elige el camino solo | ✅ (regla del dueño) | — | — | parcial | parcial | parcial |
| Fotos, vídeo, archivos sin internet | ✅ hasta 1 GB, vídeo HD | ❌ | ❌ | fotos | ? | texto |
| Llamadas de voz sin internet | ✅ Bluetooth / Wi-Fi (Bluetooth lento: voz con segundos de retraso, pendiente) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Videollamadas sin internet | ✅ mismo Wi-Fi | ❌ | ❌ | ❌ | ❌ | ❌ |
| Grupos | ✅ | ✅ | ✅ | ✅ | ✅ canales | difusión sin cifrar |
| Cifrado | Double Ratchet + poscuántico + remitente oculto (suplantación por un teléfono cercano: arreglo en la 2768) | Signal | referencia | ✅ (auditado 2017) | Noise (sin auditoría al lanzar) | críticas 2020–21 |
| ID Bluetooth que cambia (no te rastrean) | ✅ | — | — | — | efímero | ? |
| Recibir con la app cerrada | ✅ Bluetooth e internet | ✅ | ✅ | servicio fijo | ? | ? |
| Copia de seguridad | ✅ Fénix (en tus contactos, sin servidor) | nube | sí | ❌ | ❌ | ❌ |
| Sin número de teléfono | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| iPhone | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| En tiendas (Play Store) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Auditoría externa / uso a gran escala | ❌ / ❌ | ✅ | ✅ | ✅ / pequeño | ❌ / medio | pequeño |
| Foto de perfil | ✅ (2766) | ✅ | ✅ | ✅ (desde 2021) | ? (nombre o "anon") | ? |
| Estados / buscar en los chats | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | blogs / ? | ? | ? |

Corrección respecto a la versión anterior de esta tabla: Briar sí tiene foto de perfil (versión 1.3, 2021); en bitchat
y Bridgefy no se pudo confirmar (antes ponía ❌).

**Dónde gana NEXO:** es la única que junta todos los caminos (Bluetooth, Wi-Fi, Wi-Fi Direct, L2CAP, internet, Tor
y Jump) y cambia sola; la única que hace llamadas y videollamadas sin internet; archivos grandes y vídeo HD sin
internet; cifrado al nivel de Signal y con poscuántico; copia de la cuenta sin servidores (Fénix).

**Dónde pierde (puntos débiles):** solo Android y fuera de las tiendas; muy pocas pruebas reales (2–3 teléfonos) y
cada prueba del dueño ha sacado fallos graves; sin auditoría externa (la revisión de la 2768 encontró que un teléfono
cercano con un NEXO modificado podía hacerse pasar por un contacto: textos y llamadas sin cifrar se aceptaban);
consumo de batería sin medir; voz con segundos de retraso por un Bluetooth lento; faltan estados y buscar en los
chats (en "Agregar", "Buscar contacto…" es solo un dibujo).

**Qué cambió desde la tabla anterior (2763 → 2767, 2768 en curso):** foto de perfil (2766); avisos y llamadas que
encienden la pantalla y se ven encima del bloqueo (2766); la causa de "sin dirección .onion" en Tor, corregida (2766,
sin confirmar); el agujero de suplantación, encontrado y con arreglo en la 2768; el retraso de la voz por un
Bluetooth lento, medido (pendiente).

## 2. Estado de avance

✅ hecho / probado · ⚠️ probado en teléfonos con fallos (arreglo sin confirmar) · ⏳ sin probar en teléfonos ·
🔧 arreglo en curso (2768)

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
| Avisos en segundo plano / app cerrada | ✅ | ✅ | ⏳ |
| Pantalla apagada: avisos y llamadas que la encienden | ✅ | ✅ | ⏳ (2766) |
| Cifrado de extremo a extremo | ✅ | ✅ | ✅; suplantación cercana 🔧 |
| Grupos (con HD y archivos grandes) | ✅ | ✅ | ⏳ |
| Llamadas de voz | ✅ | ✅ | ⚠️ un teléfono no oía (arreglo 2762); 🔧 14 fallos de la revisión |
| Videollamadas (mismo Wi-Fi) | ✅ | ✅ | ⚠️ (2762); 🔧 |
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
| Revisión completa por partes | 2 de 4 hechas, la 3.ª (llamadas) a medias: ~60 % |
| Confirmado en teléfonos reales | 4 de 21 partes: ~20 % |
| Salida al público (pruebas con 3–4 teléfonos, auditoría externa, Play Store) | 0 de 3 |
| **En conjunto** (pesos: funciones 40 %, revisión 20 %, teléfonos 25 %, salida 15 %) | **~50 %** |

## Fuentes

- bitchat: [GitHub](https://github.com/permissionlesstech/bitchat), [Android](https://github.com/permissionlesstech/bitchat-android), [Wikipedia](https://en.wikipedia.org/wiki/BitChat), [TechCrunch 2025](https://techcrunch.com/2025/07/07/jack-dorsey-working-on-bluetooth-messaging-app-bitchat/), [AlternativeTo 2026](https://alternativeto.net/news/2026/8/bitchat-adds-offline-android-app-sharing-with-direct-device-transfer/), [Android Infotech oct. 2026](https://www.androidinfotech.com/bitchat-features-limitations/), [Xataka (nombre o "anon")](https://www.xatakamovil.com/aplicaciones/he-probado-bitchat-alternativa-a-whatsapp-creador-twitter-que-no-necesita-internet-diferente-que-dudo-su-futuro)
- Briar: [briarproject.org](https://briarproject.org/), [F-Droid](https://f-droid.org/de/packages/org.briarproject.briar.android/), [Briar 1.3: foto de perfil (2021)](https://briarproject.org/news/2021-briar-1.3-released/)
- Bridgefy: [bridgefy.me](https://bridgefy.me/), [TechCrunch 2020](https://techcrunch.com/2020/11/02/bridgefy-launches-end-to-end-encrypted-messaging-for-the-app-used-during-protests-and-disasters)
- WhatsApp sin internet: [TechRadar](https://www.techradar.com/computing/software/whatsapp-could-soon-get-internet-free-file-sharing-thanks-to-airdrop-style-upgrade), [Neowin](https://www.neowin.com/news/whatsapp-spotted-testing-a-new-offline-file-transfer-feature-called-people-nearby/)
- Berty (no incluida en la tabla: estado de 2026 sin confirmar): [berty.tech](https://berty.tech/pl/features)
