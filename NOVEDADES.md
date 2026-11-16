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
- Al abrir un chat, NEXO ya busca el mejor camino para que tu mensaje salga al instante.
- Los emojis que mandas solos se ven grandes y sin burbuja.
- Si tienes las notificaciones de NEXO apagadas, te avisamos en Contactos y te llevamos a activarlas.
- Al agregar a alguien a una videollamada, el video sigue: la pantalla se divide en dos y con doble toque pones a uno en grande.
- Arreglado: llamadas en las que el otro no te oía si salías de la app mientras sonaba.
</es-419>
<it-IT>
- Quando apri una chat, NEXO cerca già la strada migliore perché il tuo messaggio parta subito.
- Le emoji inviate da sole si vedono grandi e senza fumetto.
- Se le notifiche di NEXO sono disattivate, te lo diciamo in Contatti e ti portiamo ad attivarle.
- Aggiungendo qualcuno a una videochiamata il video continua: lo schermo si divide in due e con un doppio tocco ne ingrandisci uno.
- Risolto: chiamate in cui l'altro non ti sentiva se uscivi dall'app mentre squillava.
</it-IT>
<en-US>
- When you open a chat, NEXO already finds the best route so your message goes out instantly.
- Emojis sent on their own now show big, without a bubble.
- If NEXO notifications are off, Contacts tells you and takes you to turn them on.
- Adding someone to a video call keeps the video: the screen splits in two, and a double tap makes one person full screen.
- Fixed: calls where the other person couldn't hear you if you left the app while it rang.
</en-US>
<pt-BR>
- Ao abrir uma conversa, o NEXO já procura o melhor caminho para sua mensagem sair na hora.
- Emojis enviados sozinhos aparecem grandes e sem balão.
- Se as notificações do NEXO estiverem desligadas, avisamos em Contatos e levamos você para ativá-las.
- Ao adicionar alguém a uma videochamada, o vídeo continua: a tela se divide em duas e com dois toques você amplia um.
- Corrigido: chamadas em que o outro não te ouvia se você saía do app enquanto tocava.
</pt-BR>
<fr-FR>
- Dès que vous ouvrez un chat, NEXO cherche le meilleur chemin pour que votre message parte aussitôt.
- Les emojis envoyés seuls s'affichent en grand, sans bulle.
- Si les notifications de NEXO sont désactivées, Contacts vous le signale et vous emmène les activer.
- Ajouter quelqu'un à un appel vidéo garde la vidéo : l'écran se partage en deux et un double appui agrandit une personne.
- Corrigé : appels où l'autre ne vous entendait pas si vous quittiez l'app pendant la sonnerie.
</fr-FR>
<!-- /APK -->

## Historial

### APK 3073 (16-11-2026; la 3071 y la 3072 se pararon en las pruebas: esta las lleva juntas)
- Al llamar oyes el «tuuu… tuuu…» mientras suena del otro lado.
- Más protección contra impostores al agregar contactos, unir chats y pagar cobros.
- Tu respaldo elige solo a tus contactos más cercanos como guardianes.
- Desliza un mensaje a la derecha para responderlo. En la nota de voz: desliza a la izquierda para cancelar o mantén y suelta para enviar.
- Oculta el texto de los avisos de un chat desde sus opciones.
- Ajustes por secciones y el mismo estilo limpio en toda la app, también en las llamadas.

### APK 3070 (16-11-2026)
- Invita a tus amigos a NEXO con un enlace por WhatsApp, TikTok o donde quieras: al tocarlo te agregan.
- Si borras un contacto y lo vuelves a agregar, ves su foto de perfil de ahora, no una vieja.
- Al guardar una foto o un vídeo en tu galería, el botón se pone verde y te dice dónde quedó.
- Deslizar para actualizar gasta muchos menos datos.
- Escucha las notas de voz a 1.5× o 2× con el botón de velocidad.
- Un contacto que agregas en persona sale en línea por internet al momento.

### APK 3069 (15-11-2026)
- Una nota de voz o una foto por internet a alguien con la app dormida ya no gasta tus datos reenviándose: espera a que despierte.
- Las fotos y notas de voz por internet llegan mucho más rápido.
- Las llamadas por internet gastan menos datos.

### APK 3068 (15-11-2026)
- Un mensaje largo que pasa por el teléfono de otro contacto ya no se queda reenviándose si ese teléfono está dormido: busca otro camino.

### APK 3067 (15-11-2026)
- Si mandas un archivo a alguien con la app dormida, NEXO la despierta y espera a que conteste, sin gastar batería reenviándolo.

### APK 3066 (15-11-2026)
- NEXO ya está en portugués y en francés.
- Los avisos del teléfono (mensajes, llamadas, actualizaciones) salen en el idioma de la app.
- El diagnóstico registra si la app se cierra y por qué, y cuántos datos usa NEXO, para arreglar fallos más rápido.
- Mejoras internas para que la app sea más estable y fácil de mantener.

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
