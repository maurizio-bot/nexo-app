# NEXO — Comparativa con la competencia y estado de avance

Hecha el 24-10-2026 (build 2763 publicada; 2764 en pruebas). Actualizar cuando cambie algo importante.
Los datos de NEXO salen del código; los de la competencia, de sus páginas y noticias (enlaces al final). Lo que no se
pudo confirmar va marcado con "?".

## 1. Comparativa

| Función | NEXO | WhatsApp | Signal | Briar | bitchat | Bridgefy |
|---|---|---|---|---|---|---|
| Sin internet (Bluetooth) | ✅ | ❌ (archivos cerca: beta 2024, sin confirmar) | ❌ | ✅ | ✅ | ✅ |
| Malla multi-salto | ✅ Jump (8 saltos, guarda 24 h) | ❌ | ❌ | ❌ | ✅ (7 saltos) | ✅ |
| Wi-Fi local / Wi-Fi Direct | ✅ / ✅ | ❌ | ❌ | ✅ / ❌ | ? | ❌ |
| Internet cuando hay | ✅ relés Nostr + Tor | ✅ | ✅ | ✅ Tor | ✅ Nostr | ✅ |
| Elige el camino solo | ✅ (regla del dueño) | — | — | parcial | parcial | parcial |
| Fotos, vídeo, archivos sin internet | ✅ hasta 1 GB, vídeo HD | ❌ | ❌ | fotos | ? | texto |
| Llamadas de voz sin internet | ✅ Bluetooth / Wi-Fi | ❌ | ❌ | ❌ | ❌ | ❌ |
| Videollamadas sin internet | ✅ mismo Wi-Fi | ❌ | ❌ | ❌ | ❌ | ❌ |
| Grupos | ✅ | ✅ | ✅ | ✅ | ✅ canales | difusión sin cifrar |
| Cifrado | Double Ratchet + poscuántico + remitente oculto | Signal | referencia | ✅ (auditado 2017) | Noise (sin auditoría al lanzar) | críticas 2020–21 |
| ID Bluetooth que cambia (no te rastrean) | ✅ | — | — | — | efímero | ? |
| Recibir con la app cerrada | ✅ Bluetooth e internet | ✅ | ✅ | servicio fijo | ? | ? |
| Copia de seguridad | ✅ Fénix (en tus contactos, sin servidor) | nube | sí | ❌ | ❌ | ❌ |
| Sin número de teléfono | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| iPhone | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ |
| En tiendas (Play Store) | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Auditoría externa / uso a gran escala | ❌ / ❌ | ✅ | ✅ | ✅ / pequeño | ❌ / medio | pequeño |
| Foto de perfil, estados | ❌ / ❌ | ✅ / ✅ | ✅ / ✅ | ❌ | ❌ | ❌ |

**Dónde gana NEXO:** es la única que junta todos los caminos (Bluetooth, Wi-Fi, Wi-Fi Direct, L2CAP, internet, Tor
y Jump) y cambia sola; la única que hace llamadas y videollamadas sin internet; archivos grandes y vídeo HD sin
internet; cifrado al nivel de Signal y con poscuántico; copia de la cuenta sin servidores (Fénix).

**Dónde pierde (puntos débiles):** solo Android y fuera de las tiendas; muy pocas pruebas reales (2–3 teléfonos) y
fallos graves que salen al probar (2758–2763); sin auditoría externa; consumo de batería sin medir; Tor no funciona
en los teléfonos ("sin dirección .onion" en el diagnóstico del Vivo); falta lo básico de una app social (foto de
perfil, estados, buscar en los chats).

## 2. Estado de avance

✅ hecho / probado · ⚠️ probado en teléfonos con fallos (arreglo sin confirmar) · ⏳ sin probar en teléfonos

| Parte | Código | Simulador | Teléfonos |
|---|---|---|---|
| Escaneo y agregar | ✅ | ✅ | ⚠️ no se veía a nadie tras borrar (2764) |
| Conexión Bluetooth | ✅ | ✅ | ⚠️ enlace rehecho cada 30 s (2761) |
| Textos cortos y largos | ✅ | ✅ | ✅ (2713) |
| Envío al teléfono correcto | ✅ | ✅ | ⚠️ llegaba al Vivo (2764) |
| Fotos y archivos por Bluetooth | ✅ | ✅ | ⚠️ no llegaban (2761) |
| Archivos grandes hasta 1 GB | ✅ | ✅ | ⏳ |
| Wi-Fi Direct | ✅ | ✅ | ✅ (2713) |
| Wi-Fi misma red y camino del dueño | ✅ | ✅ | ⏳ |
| Internet por relés | ✅ | ✅ | ✅ (diagnóstico del Vivo) |
| Internet por Tor | ✅ | ✅ | ❌ sin dirección .onion |
| Jump | ✅ | ✅ | ⏳ |
| Avisos en segundo plano / app cerrada | ✅ | ✅ | ⏳ |
| Cifrado de extremo a extremo | ✅ | ✅ | ✅ |
| Grupos (con HD y archivos grandes) | ✅ | ✅ | ⏳ |
| Llamadas de voz | ✅ | ✅ | ⚠️ un teléfono no oía (2762) |
| Videollamadas (mismo Wi-Fi) | ✅ | ✅ | ⚠️ (2762) |
| Fénix | ✅ | ✅ | ⏳ |
| Pasar la cuenta | ✅ | ✅ | ⏳ |
| Interfaz estilo NEXO | ✅ | ✅ | ⚠️ barra gris al girar (2764) |

Plan del dueño (23-10, PENDIENTES §5): puntos 1–17 hechos en código (13 L2CAP y 17 videollamadas con una segunda
fase pendiente; 15 B, varios dispositivos a la vez, para después). Faltan 18 (pruebas con 3–4 teléfonos), 19
(auditoría externa) y 20 (Play Store). Sin decidir: pagos, Stream, iPhone, núcleos.

## Fuentes

- bitchat: [GitHub](https://github.com/permissionlesstech/bitchat), [Android](https://github.com/permissionlesstech/bitchat-android), [Wikipedia](https://en.wikipedia.org/wiki/BitChat), [TechCrunch 2025](https://techcrunch.com/2025/07/07/jack-dorsey-working-on-bluetooth-messaging-app-bitchat/), [AlternativeTo 2026](https://alternativeto.net/news/2026/8/bitchat-adds-offline-android-app-sharing-with-direct-device-transfer/), [Android Infotech oct. 2026](https://www.androidinfotech.com/bitchat-features-limitations/)
- Briar: [briarproject.org](https://briarproject.org/), [F-Droid](https://f-droid.org/de/packages/org.briarproject.briar.android/)
- Bridgefy: [bridgefy.me](https://bridgefy.me/), [TechCrunch 2020](https://techcrunch.com/2020/11/02/bridgefy-launches-end-to-end-encrypted-messaging-for-the-app-used-during-protests-and-disasters)
- WhatsApp sin internet: [TechRadar](https://www.techradar.com/computing/software/whatsapp-could-soon-get-internet-free-file-sharing-thanks-to-airdrop-style-upgrade), [Neowin](https://www.neowin.com/news/whatsapp-spotted-testing-a-new-offline-file-transfer-feature-called-people-nearby/)
- Berty (no incluida en la tabla: estado de 2026 sin confirmar): [berty.tech](https://berty.tech/pl/features)
