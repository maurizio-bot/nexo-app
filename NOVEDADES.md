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
- Dos llamadas a la vez, con la pantalla dividida.
- Al contestar la segunda, la otra queda en espera; «Reanudar» cambia de una a otra.
- Con dos llamadas, los botones de llamar se apagan.
- «Mensaje»: responde con un texto a quien te llama estando en otra llamada.
- Al agregar a alguien a una llamada, quien ya estaba entra solo al grupo.
- En grupo, todos se oyen aunque contesten a destiempo.
- Lo nuevo de cada versión, junto al botón de actualizar.
</es-419>
<it-IT>
- Due chiamate insieme, con lo schermo diviso.
- Rispondendo alla seconda, l'altra va in attesa; «Riprendi» passa dall'una all'altra.
- Con due chiamate, i pulsanti di chiamata si spengono.
- «Messaggio»: rispondi con un testo a chi ti chiama mentre sei in un'altra chiamata.
- Aggiungendo qualcuno a una chiamata, chi c'era già entra da solo nel gruppo.
- Nel gruppo tutti si sentono anche se rispondono in momenti diversi.
- Le novità di ogni versione, accanto al pulsante di aggiornamento.
</it-IT>
<en-US>
- Two calls at once, with a split screen.
- When you answer the second, the other goes on hold; «Resume» switches between them.
- With two calls, the call buttons are turned off.
- «Message»: reply with a text to someone calling while you're on another call.
- When you add someone to a call, the person already there joins the group on their own.
- In a group, everyone hears each other even if they answer at different times.
- What's new in each version, next to the update button.
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
