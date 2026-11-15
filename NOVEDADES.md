# Novedades de NEXO

Lo que trae cada versión, contado para el usuario (pedido del dueño 15-11: «que venga una breve descripción de lo que se hizo, para
que el user cuando la descargue pueda verificar qué es lo que se implementó… para cuando se suba a Google Play»).

- El bloque entre `<!-- APK -->` y `<!-- /APK -->` es el de la **próxima APK**: el workflow lo pone como descripción del lanzamiento
  y la app lo muestra junto al botón de actualizar (Perfil → Ajustes → Actualizaciones, y «¿Qué trae?» en el aviso de abajo).
- Formato de Google Play (se pega tal cual en «Novedades de esta versión»): un bloque por idioma (español, italiano, inglés y, desde
  la 3123, portugués de Brasil y francés), **máximo 500 caracteres** cada uno
  (lo comprueba `tests/sim/novedades.js`). Frases cortas, sin palabras técnicas; lo que el usuario nota.
- Al entregar una APK: escribir aquí lo nuevo y, después de publicarla, pasar el bloque al historial con su número.

<!-- APK -->
<es-419>
- NEXO ya está en portugués y en francés.
- Los avisos del teléfono (mensajes, llamadas, actualizaciones) salen en el idioma de la app.
- El diagnóstico registra si la app se cierra y por qué, y cuántos datos usa NEXO, para arreglar fallos más rápido.
- Mejoras internas para que la app sea más estable y fácil de mantener.
</es-419>
<it-IT>
- NEXO ora è anche in portoghese e in francese.
- Le notifiche del telefono (messaggi, chiamate, aggiornamenti) arrivano nella lingua dell'app.
- La diagnosi registra se l'app si chiude e perché, e quanti dati usa NEXO, per risolvere i problemi più in fretta.
- Miglioramenti interni per rendere l'app più stabile e facile da mantenere.
</it-IT>
<en-US>
- NEXO is now available in Portuguese and French.
- Phone notifications (messages, calls, updates) now appear in the app's language.
- Diagnostics record when and why the app closes, and how much data NEXO uses, to fix problems faster.
- Internal improvements to make the app more stable and easier to maintain.
</en-US>
<pt-BR>
- O NEXO agora está em português e em francês.
- As notificações do celular (mensagens, chamadas, atualizações) aparecem no idioma do app.
- O diagnóstico registra se o app fecha e por quê, e quantos dados o NEXO usa, para corrigir falhas mais rápido.
- Melhorias internas para deixar o app mais estável e fácil de manter.
</pt-BR>
<fr-FR>
- NEXO est désormais disponible en portugais et en français.
- Les notifications du téléphone (messages, appels, mises à jour) s'affichent dans la langue de l'app.
- Le diagnostic enregistre quand et pourquoi l'app se ferme, et la quantité de données utilisée par NEXO, pour corriger les problèmes plus vite.
- Améliorations internes pour rendre l'app plus stable et plus facile à maintenir.
</fr-FR>
<!-- /APK -->

## Historial

### APK 3065 (15-11-2026; la 3062 y la 3064 se cancelaron al construirse: esta las lleva juntas)
- Si un servidor de internet falla, la app usa otro de reserva en segundos, sin que lo notes.
- El diagnóstico muestra el nombre de cada contacto y cuánta batería gasta el teléfono con NEXO, para encontrar fallos más rápido.
- Mejoras internas para que la app sea más estable y fácil de mantener.

### APK 3061 (15-11-2026)
- Al abrir Ajustes ves al momento si hay versión nueva: «Actualizar a la versión N».
- El aviso «Hay una versión nueva» muestra lo que trae al desplegarlo.
- Al volver a la app tras un cambio de red, se reconecta una sola vez y más rápido.

### APK 3060 (15-11-2026)
- Dos llamadas a la vez, con la pantalla dividida.
- Al contestar la segunda, la otra queda en espera; «Reanudar» cambia de una a otra.
- Con dos llamadas, los botones de llamar se apagan.
- «Mensaje»: responde con un texto a quien te llama estando en otra llamada.
- Al agregar a alguien a una llamada, quien ya estaba entra solo al grupo.
- En grupo, todos se oyen aunque contesten a destiempo.
- Lo nuevo de cada versión, junto al botón de actualizar.

### APK 3059 (15-11-2026)
- En una llamada de grupo, quien no contesta en 45 segundos sale como «No contestó».
- Llamada normal y de grupo a la vez: la pantalla se divide en dos, cada una con sus botones.

### APK 3058 (15-11-2026)
- Mientras recibes algo grande por Bluetooth, NEXO sigue buscando a los contactos que se alejaron.

### APK 3057 (14-11-2026)
- Una llamada por Wi-Fi ya no frena lo que va por Bluetooth a otros contactos.
- Si la cámara está bloqueada en una videollamada, el aviso se toca y abre los permisos de NEXO.
