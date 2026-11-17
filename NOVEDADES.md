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
- Si Android cierra NEXO (por una actualización o al reiniciar), vuelve sola y sigue recibiendo mensajes por internet sin que la abras.
- Con datos móviles NEXO gasta menos datos y tus fotos y notas de voz salen más rápido.
</es-419>
<it-IT>
- Se Android chiude NEXO (per un aggiornamento o al riavvio), si riapre da sola e continua a ricevere messaggi via internet senza aprirla.
- Con i dati mobili NEXO consuma meno dati e foto e vocali partono più in fretta.
- I pulsanti delle richieste di contatto ora sono in italiano.
</it-IT>
<en-US>
- If Android closes NEXO (after an update or a restart), it comes back on its own and keeps receiving messages over the internet without opening it.
- On mobile data NEXO uses less data and your photos and voice notes go out faster.
- Contact request buttons are now in English.
</en-US>
<pt-BR>
- Se o Android fechar o NEXO (por uma atualização ou ao reiniciar), ele volta sozinho e continua recebendo mensagens pela internet sem você abrir.
- Com dados móveis o NEXO gasta menos dados e suas fotos e áudios saem mais rápido.
- Os botões das solicitações de contato agora estão em português.
</pt-BR>
<fr-FR>
- Si Android ferme NEXO (après une mise à jour ou un redémarrage), il revient tout seul et continue de recevoir les messages par internet sans l'ouvrir.
- Avec les données mobiles, NEXO consomme moins et vos photos et vocaux partent plus vite.
- Les boutons des demandes de contact sont maintenant en français.
</fr-FR>
<!-- /APK -->

## Historial

### APK 3086 (17-11-2026)
<es-419>
- Te llega una notificación cuando alguien quiere agregarte como contacto, aunque NEXO esté en segundo plano.
- NEXO se da cuenta antes cuando un contacto cercano deja de responder y lo busca por otro camino.
</es-419>
<it-IT>
- Ricevi una notifica quando qualcuno vuole aggiungerti come contatto, anche con NEXO in background.
- NEXO si accorge prima quando un contatto vicino smette di rispondere e lo cerca per un'altra strada.
- Nelle chiamate i pulsanti non vengono più tagliati: ora dicono «Video» e «Vivavoce».
</it-IT>
<en-US>
- You get a notification when someone wants to add you as a contact, even with NEXO in the background.
- NEXO notices sooner when a nearby contact stops responding and reaches them another way.
</en-US>
<pt-BR>
- Você recebe uma notificação quando alguém quer te adicionar como contato, mesmo com o NEXO em segundo plano.
- O NEXO percebe antes quando um contato próximo para de responder e o procura por outro caminho.
</pt-BR>
<fr-FR>
- Vous recevez une notification quand quelqu'un veut vous ajouter comme contact, même avec NEXO en arrière-plan.
- NEXO remarque plus vite quand un contact proche ne répond plus et le joint autrement.
</fr-FR>

### APK 3085 (17-11-2026)
<es-419>
- Al grabar una nota de voz, los botones de borrar y enviar ya no se cortan.
- Con muchos NEXO cerca, la app va más ligera y tus contactos se conectan antes.
</es-419>
<it-IT>
- Mentre registri un vocale, i pulsanti per eliminare e inviare non vengono più tagliati.
- Con tanti NEXO vicini, l'app è più leggera e i tuoi contatti si collegano prima.
</it-IT>
<en-US>
- While recording a voice note, the delete and send buttons are no longer cut off.
- With many NEXO users nearby, the app runs lighter and your contacts connect sooner.
</en-US>
<pt-BR>
- Ao gravar um áudio, os botões de apagar e enviar não ficam mais cortados.
- Com muitos NEXO por perto, o app fica mais leve e seus contatos se conectam antes.
</pt-BR>
<fr-FR>
- Pendant l'enregistrement d'un vocal, les boutons supprimer et envoyer ne sont plus coupés.
- Avec beaucoup de NEXO autour, l'app est plus légère et vos contacts se connectent plus vite.
</fr-FR>

### APK 3084 (17-11-2026)
- El «leído» y las dos palomitas llegan aunque se corte la conexión justo en ese momento; los archivos ya no se atoran en la fila.

### APK 3083 (17-11-2026)
- Todos los botones responden igual al tocarlos; adiós al cuadrado en los botones de las llamadas.
- Un contacto ya no se queda arriba en tu lista si no te escribió nada nuevo.
- «Eliminar para todos» ahora borra siempre, aunque el borrado llegue antes que el mensaje; reacciones y fotos de grupo más fiables.

### APK 3082 (16-11-2026)
- Los mensajes que ya llegaron ya no se quedan como pendientes ni se vuelven a mandar al abrir la app.
- Con datos móviles lentos, NEXO se da cuenta antes y tus mensajes salen más rápido.

### APK 3081 (16-11-2026)
- Fotos más nítidas: se mandan a mayor tamaño y calidad, sobre todo por Wi-Fi e internet.
- «Cámara» abre la cámara de tu teléfono: fotos con toda su calidad y modo noche. Si sales sin tomar foto, puedes grabar video con la de NEXO.
- Ya no te llegan avisos del chat que tienes abierto.

### APK 3080 (16-11-2026)
- Los estados ahora tienen su propia pantalla: desliza Contactos hacia la izquierda para verlos.

### APK 3079 (16-11-2026; la 3078 se paró en las pruebas: esta la lleva)
- Bluetooth más estable: si dos teléfonos quedan conectados dos veces, NEXO cierra la conexión sobrante y se queda con la más rápida.

### APK 3077 (16-11-2026; la 3076 se paró en las pruebas: esta la lleva)
- Desliza entre las fotos y videos de un chat; para salir, desliza arriba o abajo.
- Al mandar fotos o videos, toca el ojo de los que quieras que se vean una sola vez.
- Toca un enlace de TikTok, Instagram, Facebook o YouTube y se abre en su app; comparte a NEXO desde «Compartir».
- El aviso fijo de NEXO ya no tapa tus mensajes.
- Arreglado: guardar videos en la galería, el «leído» al abrir desde el aviso y letras cortadas en las burbujas.

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
