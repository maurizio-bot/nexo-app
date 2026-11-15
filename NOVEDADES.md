# Novedades de NEXO

Lo que trae cada versión, contado para el usuario (pedido del dueño 15-11: «que venga una breve descripción de lo que se hizo, para
que el user cuando la descargue pueda verificar qué es lo que se implementó… para cuando se suba a Google Play»).

- El bloque entre `<!-- APK -->` y `<!-- /APK -->` es el de la **próxima APK**: el workflow lo pone como descripción del lanzamiento
  y la app lo muestra junto al botón de actualizar (Perfil → Ajustes → Actualizaciones, y «¿Qué trae?» en el aviso de abajo).
- Formato de Google Play (se pega tal cual en «Novedades de esta versión»): un bloque por idioma, **máximo 500 caracteres** cada uno
  (lo comprueba `tests/sim/novedades.js`). Frases cortas, sin palabras técnicas; lo que el usuario nota.
- Al entregar una APK: escribir aquí lo nuevo y, después de publicarla, pasar el bloque al historial con su número.

<!-- APK -->
<es-419>
- Dos llamadas a la vez: la segunda suena abajo y la pantalla se divide en dos.
- Al contestar la segunda, la otra queda en espera; con «Reanudar» cambias de una a otra.
- Máximo dos llamadas: con dos, los botones de llamar se apagan.
- «Mensaje»: si te llaman estando en otra llamada, responde con una frase lista o tu propio texto.
- Ahora ves lo nuevo de cada versión junto al botón de actualizar.
</es-419>
<it-IT>
- Due chiamate insieme: la seconda squilla in basso e lo schermo si divide in due.
- Rispondendo alla seconda, l'altra va in attesa; con «Riprendi» passi dall'una all'altra.
- Massimo due chiamate: con due, i pulsanti di chiamata si spengono.
- «Messaggio»: se ti chiamano mentre sei in un'altra chiamata, rispondi con una frase pronta o un tuo testo.
- Ora vedi le novità di ogni versione accanto al pulsante di aggiornamento.
</it-IT>
<en-US>
- Two calls at once: the second one rings at the bottom and the screen splits in two.
- When you answer the second, the other goes on hold; tap «Resume» to switch between them.
- Up to two calls: with two, the call buttons are turned off.
- «Message»: if someone calls while you're on another call, reply with a ready-made phrase or your own text.
- You now see what's new in each version next to the update button.
</en-US>
<!-- /APK -->

## Historial

### APK 3059 (15-11-2026)
- En una llamada de grupo, quien no contesta en 45 segundos sale como «No contestó».
- Llamada normal y de grupo a la vez: la pantalla se divide en dos, cada una con sus botones.

### APK 3058 (15-11-2026)
- Mientras recibes algo grande por Bluetooth, NEXO sigue buscando a los contactos que se alejaron.

### APK 3057 (14-11-2026)
- Una llamada por Wi-Fi ya no frena lo que va por Bluetooth a otros contactos.
- Si la cámara está bloqueada en una videollamada, el aviso se toca y abre los permisos de NEXO.
