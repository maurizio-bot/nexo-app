# NEXO — Lo que falta (lista viva)

Lista pedida por el dueño el 23-10-2026 para no olvidar nada. Leer al empezar cada sesión (CLAUDE.md lo indica) y
actualizar al terminar cada bloque. Estado al día de cada build: `docs/PROGRESO.md`.

## Reglas para elegir el camino de envío (decididas por el dueño, 23-10-2026)
1. **Wi-Fi en el mismo router/módem: prioridad sobre todo** (seguro, rápido, no gasta datos). No se cambia a otro
   camino por un corte breve: primero se intenta recuperar el Wi-Fi.
2. **Mala señal Wi-Fi**: según la velocidad real medida, puede pasar a Bluetooth (y volver al Wi-Fi cuando mejore).
3. **Wi-Fi Direct: segunda opción** (para fotos, vídeos y archivos grandes; para un texto corto no compensa montar el
   grupo y va por Bluetooth).
4. **Sin red Wi-Fi ni Wi-Fi Direct: Bluetooth**. Después, Jump. Si no hay ningún camino: pendiente hasta que aparezca.

## 1. Pendiente de pruebas del dueño en el teléfono
- 2718: chat (responder, reenviar, eliminar, copiar) y cámara nueva.
- 2720: los datos siguen tras actualizar; huella y bloqueo de capturas.
- 2725: fotos en las dos direcciones sin quedarse paradas.
- 2728: Wi-Fi normal y cambio de camino. **Informe del dueño: estando en Wi-Fi, al mandar una foto pasó a
  Bluetooth (los dos en el mismo router)** → corregido en la ronda 2730 (reglas del dueño; ver PROGRESO).
- 2730: Wi-Fi (seguir en Wi-Fi con la app en segundo plano y en cortes breves), QR del número de seguridad,
  aviso "Protección poscuántica activa", Jump con remitente oculto.
- Wi-Fi Direct: falta el diagnóstico con tiempos para acelerarlo.
- 2749: Tor nuevo (0.4.9.14) e internet en general (relés y Tor reales no se alcanzan desde el entorno de desarrollo).
- 2751/2752: notificaciones (permiso, una por chat, número en el icono, tocar abre el chat), contadores de no leídos,
  "leído" solo con la app a la vista, recibir por internet con la app en segundo plano.
- 2754: fotos, vídeo y PDF por Bluetooth en binario (deben llegar enteros y algo más rápido); y con un teléfono en la
  2752, que todo siga llegando.

## 2. Funciones nuevas
- **Llamadas de voz**: posibles por Bluetooth (voz comprimida ~2 KB/s); por Wi-Fi / Wi-Fi Direct con calidad alta.
  Captura y reproducción en tiempo real, pantalla de llamada, timbre (también en segundo plano), cifrado.
- **Videollamadas**: solo por Wi-Fi o Wi-Fi Direct (Bluetooth no da el ancho). Sobre lo de voz.
- **Pagos**: decidir modelo (saldo propio, tarjeta/banco, cripto); doble gasto sin conexión, conciliación,
  regulación del país (posible licencia). Asesoría legal antes de programar.
- **Stream** (vídeos tipo TikTok + estados de contactos, gestos: tap arriba izq. vídeos, arriba der. estados, doble tap
  "me gusta", deslizar der→izq comentarios, izq→der volver): **SIN DECIDIR** (sí/no; solo cercanos o con servidor).
- **Chats de grupo**: no existen todavía.
- **Internet** (contactos lejos, Wi-Fi de módems distintos): hecho en la ronda 2739 con relés públicos Nostr y Tor
  (decisión del dueño 23-10, "2 y 3"; ver `docs/INTERNET.md`). Falta: confirmar en los teléfonos (los relés y Tor
  reales no se alcanzan desde el entorno de desarrollo); servidor propio si los relés públicos fallan o limitan.
  Recibir con la app en segundo plano: hecho en la 2751 (NetBg nativo).
- **iPhone**: plugin en Swift, cuenta Apple Developer (99 USD/año), Mac o runners macOS, iPhones para probar.
- **Núcleos** (universidad, papelería, cafetería…) y **caso papelería** (PDF → imprimir → pagar).
- **Fénix**: hecho en la ronda 2732 el respaldo de los mensajes de texto (fase 2). Falta: fotos, vídeos y archivos
  (mejor por Wi-Fi); pingeo por Jump (hoy solo con el contacto conectado).

## 3. Mejoras de lo que ya existe
- **Velocidad**: archivos en binario hecho (2754); L2CAP; Wi-Fi Direct más rápido; detectar y renegociar MTU
  pequeño (algunos teléfonos se quedan en 20 bytes por escritura).
- **Jump con más alcance**: hecho en la ronda 2731 (en el teléfono, por confirmar): Bluetooth de largo alcance (LE
  Coded PHY, ~4x distancia entre teléfonos que lo tengan; el diagnóstico dice `[JUMP] Largo alcance (LE Coded): sí/no`)
  y hasta 8 saltos (antes 4). Ya existía guardar y reenviar (el puente guarda hasta 24 h). Falta: Jump también por
  Wi-Fi; Jump con la app en segundo plano o cerrada.
- **Seguridad (resto de la fase 3)**: identificador Bluetooth rotativo (falta decisión, ver 4). Hechos en la
  ronda 2730: remitente oculto a los puentes, poscuántico (ML-KEM) y QR del número de seguridad.
- **Fiabilidad**: recibir con la app cerrada del todo (servidor GATT en el BleService); falta `@capacitor/app`.
  Hecho en la ronda 2744: fuera `NordicMeshService` del manifiesto, emojis y acentos (prueba en `e2e.js`; la vista
  previa partía emojis), nombres ya iban como texto en la lista.
- **Base estable nueva** (≥ 2725) cuando el dueño confirme.

## 4. Decisiones pendientes del dueño
1. Stream: ¿sí o no? ¿solo cercanos o con servidor?
2. ~~Internet: punto de encuentro~~ — decidido el 23-10: relés públicos + Tor, sin servidor propio por ahora
   (ronda 2739). Queda abierto si más adelante se quiere un servidor propio.
3. Pagos: modelo y país.
4. iPhone: ¿cuenta de Apple?
5. **Identificador Bluetooth rotativo** (seguridad, punto 9): hoy cualquiera con un escáner ve el NEXO ID en el
   aire y puede seguir a una persona. Con un identificador que cambia cada pocos minutos y que solo los
   contactos reconocen, un desconocido ya no puede. Pero ese NEXO ID visible es lo que hoy permite (a) agregar a
   alguien que está cerca y (b) que un teléfono NEXO desconocido haga de puente en Jump. Propuesta: rotativo por
   defecto; visible solo mientras se tiene abierto "Agregar" (unos minutos) y, para Jump con desconocidos, una
   opción "Ayudar a la red (Jump)" activada por defecto que anuncia una marca anónima de la red, no el NEXO ID.
   ¿Te parece?
6. Orden propuesto: lo que falle en sus pruebas → velocidad (binario, L2CAP) → llamadas de voz → Jump de más
   alcance → seguridad restante → grupos → videollamadas.

## 5. Plan del dueño (23-10): completar lo que falta y mejorar los puntos débiles de la comparativa (sin iPhone)
De lo más simple a lo más complejo. Estado:
1. ✅ (2744) Limpieza: versiones reales en los registros, fuera `NordicMeshService`, tarjetas de pago escapadas.
2. ✅ (2744) Pruebas en cada build: trabajo `tests` en el workflow (Kotlin JVM + `tests/sim/ci.js`, 9 escenarios); si
   falla, no hay APK. Ya encontró un fallo real (Jump + internet, ver ronda 2744).
3. ✅ (2744) Emojis y acentos: llegan idénticos; la vista previa ya no parte emojis.
4. ID Bluetooth rotativo: **no aplicado**. El dueño lo autorizó solo si es seguro que no da problemas; no lo es:
   la recuperación de Fénix busca a los contactos por el NEXO ID que anuncian y un teléfono recién recuperado
   todavía no sabría reconocer un ID rotativo; también afecta a agregar desconocidos, a Jump con desconocidos y a
   teléfonos con builds viejas. Hace falta un diseño con pruebas de esos casos antes de decidir.
5. ✅ (2749) AGP 9.4.0 / Gradle 9.6.0 / Kotlin 2.2.20 / compileSdk 37.1 y Tor 0.4.9.14 (targetSdk sigue en 34).
6. ✅ (2752) Dividir `main.js` (4.281 → 720 líneas) y `ble_interface.js` (3.732 → 847) en 30 módulos sin cambiar el
   código (`docs/ESTRUCTURA.md`). 7. ✅ (2754) Bluetooth sin base64: los trozos de datos de fotos, vídeos y archivos
   van en binario (−25 % de bytes por la radio, ~25–35 % más rápido en el simulador); solo con teléfonos que lo
   anuncian (`bf`), con builds anteriores sigue el JSON de siempre.
8. Detectar MTU pequeño. 9. Fénix para fotos/vídeos/archivos. 10. Jump por Wi-Fi.
11. ✅ (2751) Recibir por internet en segundo plano (NetBg nativo) + notificaciones del teléfono + número en el icono
   + contadores de no leídos por todas las vías (pedido del dueño 23-10). 12. Recibir por Bluetooth con la app cerrada. 13. L2CAP.
14. Grupos. 15. Varios dispositivos. 16. Llamadas de voz. 17. Videollamadas.
18–20 (del dueño): pruebas reales con 3–4 teléfonos, auditoría externa, Play Store.

