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
- Desliza entre las fotos y videos de un chat; para salir, desliza hacia arriba o abajo. Guardar quedó abajo a la derecha.
- Al mandar fotos de la galería, toca el ojo de las que quieras que se vean una sola vez.
- Arreglado: guardar un video en la galería.
- Arreglado: el «leído» al abrir un chat desde el aviso.
</es-419>
<it-IT>
- Scorri tra le foto e i video di una chat; per uscire, scorri in alto o in basso. Salva ora è in basso a destra.
- Inviando foto dalla galleria, tocca l'occhio di quelle che vuoi far vedere una sola volta.
- Risolto: salvare un video nella galleria.
- Risolto: il «letto» aprendo una chat dalla notifica.
</it-IT>
<en-US>
- Swipe between a chat's photos and videos; swipe up or down to close. Save is now at the bottom right.
- When sending photos from the gallery, tap the eye on the ones you want seen only once.
- Fixed: saving a video to the gallery.
- Fixed: "read" receipts when opening a chat from a notification.
</en-US>
<pt-BR>
- Deslize entre as fotos e vídeos de uma conversa; para sair, deslize para cima ou para baixo. Salvar agora fica no canto inferior direito.
- Ao enviar fotos da galeria, toque no olho das que você quer que sejam vistas só uma vez.
- Corrigido: salvar um vídeo na galeria.
- Corrigido: o «lido» ao abrir uma conversa pela notificação.
</pt-BR>
<fr-FR>
- Glissez entre les photos et vidéos d'un chat ; pour sortir, glissez vers le haut ou le bas. Enregistrer est maintenant en bas à droite.
- En envoyant des photos de la galerie, touchez l'œil de celles à voir une seule fois.
- Corrigé : enregistrer une vidéo dans la galerie.
- Corrigé : le « lu » en ouvrant un chat depuis une notification.
</fr-FR>
<!-- /APK -->

## Historial

### APK 3075 (16-11-2026; la 3074 se paró en las pruebas: esta la lleva)
- Al abrir un chat, NEXO prepara el camino para que tu mensaje salga al instante.
- Los emojis solos se ven grandes y sin burbuja.
- Si las notificaciones están apagadas, te avisamos y te llevamos a activarlas.
- Agregar a alguien a una videollamada ya no corta el video; con doble toque agrandas a uno.
- Llamadas: «atrás» las minimiza en una barra arriba, la de voz pasa a video sin colgar y aguantan el cambio de Wi-Fi a datos.
- Arreglado: el otro no te oía si salías de la app mientras sonaba.

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
