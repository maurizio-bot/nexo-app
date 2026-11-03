# NEXO — Pruebas físicas para ponerte al corriente (dueño)

> Para qué: el simulador prueba la lógica, pero lo REAL (Bluetooth, batería, app cerrada, audio) solo se confirma en los
> teléfonos. Esta lista te pone al día con todo lo de los últimos builds. **Hacelas con los DOS teléfonos.**
>
> **Regla de oro si algo falla:** en los dos teléfonos → **Perfil → Copiar diagnóstico** y me lo pasás. Sin eso, no puedo
> arreglar lo que no reproduzco en el simulador. Anotá también **qué build** tenés (abajo a la izquierda / Perfil).

---

## 🟢 BLOQUE 1 — Lo de hoy (instalar la 2899; trae TODO lo de la tarde)
La **nightly-2899** es acumulativa: logo + despertador + splash + SEC-3 + pacing. Instalala en los dos teléfonos.

1. **Logo nuevo (¿te convence?).**
   - Mirá el **ícono** en la pantalla de inicio.
   - Abrí la app → el **splash** (el logo un instante).
   - Que llegue un mensaje → la **silueta blanca** del logo arriba en la barra de estado.
   - ✅ Pasa si: se ve limpio, sin el disco negro de antes. ✍️ Decime si lo dejamos fijo o ajustamos (centrado, etc.).

2. **Despertador (lo más importante de diciembre).**
   - Teléfono B con NEXO **cerrada del todo** (fuera de recientes) unos minutos.
   - Desde A, mandale un mensaje.
   - ✅ Pasa si: B **despierta** y el mensaje llega (como WhatsApp). Probar también: foto, y **llamada** entrante.
   - Repetir con A cerrado y B mandando. Probar con **pantalla apagada**.

3. **Pacing (texto no se traba detrás de un archivo, Bluetooth).**
   - Poné a A y B **solo por Bluetooth** (Wi-Fi apagado en ambos), cerca.
   - Desde A: empezá a mandar un **vídeo/archivo grande** y, mientras va, mandá **varios textos**.
   - ✅ Pasa si: los **textos llegan enseguida** aunque el archivo siga subiendo (antes se quedaban en ○ detrás del archivo).

4. **Fondo de pantalla.**
   - Perfil/ajustes → poné un **fondo** para la lista y para un chat. Compartí un fondo con un contacto.
   - ✅ Pasa si: se ve el fondo, no tapa los textos, y al compartir le llega al otro.

5. **No se pierde un mensaje por un cortecito (B1).**
   - Con señal Bluetooth variable (alejate un poco y volvé), mandá textos.
   - ✅ Pasa si: no quedan mensajes «a medias»/mutilados; llegan enteros o se reintentan.

---

## 🔵 BLOQUE 2 — Áreas base (confirmar que siguen bien)
Esto sube el «índice de robustez» (hoy ~54/100; lo que lo frena es justo esta confirmación real).

6. **Escaneo y conexión.**
   - Abrí la app en ambos cerca → ✅ se **encuentran rápido** (no debería tardar). Alejate/acercate → se reconectan.
   - Con un teléfono «difícil» (MTU bajo): ✅ no debe quedar reconectando en bucle ni frenar el escaneo.

7. **Archivos.**
   - Foto, vídeo HD y un archivo grande (APK/PDF), por **Bluetooth** y por **misma Wi-Fi**.
   - ✅ Llegan completos, se abren, y si un camino no da, sale **aviso claro** (nunca «enviado» en silencio).

8. **Llamadas y videollamadas (1-a-1).**
   - Llamada de voz y videollamada cerca (Bluetooth/Wi-Fi). Probá **en el coche** (Telecom): que suene como llamada
     real, contestar/colgar desde el volante/sistema, que no se pise con Spotify.
   - ✅ Audio sin eco molesto, vídeo se ve, colgar desde el sistema funciona. ✍️ Anotá eco/volumen/foco si algo molesta.

9. **Llamada/mensaje con app CERRADA + pantalla apagada.**
   - B con app cerrada y pantalla apagada. A llama → ✅ **entra a pantalla completa** (como llamada de verdad).
   - A manda texto → ✅ llega el aviso y, al abrir, el mensaje. Revisá el **✓✓** (que A vea entregado con B cerrado).

10. **Grupos.**
    - Grupo con 3: texto, foto, audio, ubicación. Llamada de grupo si te animás.
    - ✅ Llega a todos; la burbuja no se queda en ○ si a alguien ya le llegó.

11. **Seguridad / bloqueo.**
    - Bloqueo por **huella** y por **rostro** (Perfil → Seguridad). Capturas de pantalla on/off.
    - ✅ Abre con huella/rostro; con capturas off no deja hacer screenshot.

---

## 📋 Cómo anotar (para que sirva)
Por cada prueba, una línea: **build + prueba + resultado (✅/❌) + detalle**. Ejemplo:
> `2899 · despertador B cerrado · ✅ despertó en ~3s`
> `2899 · videollamada coche · ❌ se corta el audio al entrar Spotify → mando diagnóstico de los dos`

Con esas notas actualizo el «índice de robustez» y sé qué atacar. Las ❌ con diagnóstico son oro.

---

## Prioridad si tenés poco tiempo
Hacé **1, 2 y 3** (logo, despertador, pacing) — es lo de hoy y lo más importante para diciembre. El resto cuando puedas.
