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

## 2. Funciones nuevas
- **Llamadas de voz**: posibles por Bluetooth (voz comprimida ~2 KB/s); por Wi-Fi / Wi-Fi Direct con calidad alta.
  Captura y reproducción en tiempo real, pantalla de llamada, timbre (también en segundo plano), cifrado.
- **Videollamadas**: solo por Wi-Fi o Wi-Fi Direct (Bluetooth no da el ancho). Sobre lo de voz.
- **Pagos**: decidir modelo (saldo propio, tarjeta/banco, cripto); doble gasto sin conexión, conciliación,
  regulación del país (posible licencia). Asesoría legal antes de programar.
- **Stream** (vídeos tipo TikTok + estados de contactos, gestos: tap arriba izq. vídeos, arriba der. estados, doble tap
  "me gusta", deslizar der→izq comentarios, izq→der volver): **SIN DECIDIR** (sí/no; solo cercanos o con servidor).
- **Chats de grupo**: no existen todavía.
- **Datos móviles / internet** (contactos lejos): requiere servidor de relevo (`server/` sin usar). Decisión pendiente.
- **iPhone**: plugin en Swift, cuenta Apple Developer (99 USD/año), Mac o runners macOS, iPhones para probar.
- **Núcleos** (universidad, papelería, cafetería…) y **caso papelería** (PDF → imprimir → pagar).
- **Fénix fase 2**: respaldo de mensajes y archivos; pingeo por Jump.

## 3. Mejoras de lo que ya existe
- **Velocidad**: archivos en binario (sin base64, −33 %); L2CAP; Wi-Fi Direct más rápido; detectar y renegociar MTU
  pequeño (algunos teléfonos se quedan en 20 bytes por escritura).
- **Jump con más alcance**: hecho en la ronda 2731 (en el teléfono, por confirmar): Bluetooth de largo alcance (LE
  Coded PHY, ~4x distancia entre teléfonos que lo tengan; el diagnóstico dice `[JUMP] Largo alcance (LE Coded): sí/no`)
  y hasta 8 saltos (antes 4). Ya existía guardar y reenviar (el puente guarda hasta 24 h). Falta: Jump también por
  Wi-Fi; Jump con la app en segundo plano o cerrada.
- **Seguridad (resto de la fase 3)**: identificador Bluetooth rotativo (falta decisión, ver 4). Hechos en la
  ronda 2730: remitente oculto a los puentes, poscuántico (ML-KEM) y QR del número de seguridad.
- **Fiabilidad**: recibir con la app cerrada del todo (servidor GATT en el BleService); limpiar el manifiesto
  (`NordicMeshService` inexistente, falta `@capacitor/app`); emojis/acentos en trozos; escapar nombres en la lista.
- **Base estable nueva** (≥ 2725) cuando el dueño confirme.

## 4. Decisiones pendientes del dueño
1. Stream: ¿sí o no? ¿solo cercanos o con servidor?
2. Internet / datos móviles: ¿servidor de relevo?
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
