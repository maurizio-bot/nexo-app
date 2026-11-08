# NEXO — Pruebas físicas pendientes (08-11-2026)

Lo que sigue hay que probarlo en los DOS teléfonos reales: el simulador comprueba la lógica, pero el
Bluetooth, las llamadas, el pase de cuenta y lo nativo solo se ven de verdad en el teléfono. Cada build de
abajo pasó la batería completa en verde y tiene su APK.

## A. Builds nuevos a probar

1. **2948 — pasar la cuenta (rollback del cifrado).** Pasá la cuenta a otro teléfono. Confirmá: los chats
   siguen, el canal cifrado se re-establece solo, y no aparecen errores de descifrado. Es el arreglo más
   delicado del informe de seguridad, por eso conviene probarlo bien.

2. **2949 — agregar por número (hombre en el medio silencioso).** Agregá un contacto por su número NEXO.
   Cuando el otro acepte tu solicitud, en TU teléfono debe aparecer «aceptó tu solicitud — confirmá» y recién
   al tocar «Confirmar» se agrega. Antes se agregaba solo. Al confirmar, comparen el número de seguridad.

3. **2950 — tarjeta compartida sin verificar (H3).** Que alguien te comparta un contacto en una tarjeta.
   Al abrir el chat de ese contacto, el banner debe decir «sin verificar, compará el número de seguridad».
   Cuando te conectes DIRECTO con esa persona (Bluetooth cerca), ese aviso se va solo.

4. **2951 + 2952 — LENTITUD EN BLUETOOTH (lo principal).** Con los dos teléfonos a menos de 3 metros y
   conectados por Bluetooth, mandá varios mensajes seguidos y fijate si el doble tilde de «entregado» llega
   al toque (antes tardaba varios segundos). Probá también: dejá la app un rato quieta o en segundo plano y
   volvé; mandá un mensaje y mirá si sale rápido. Y, si tenés un respaldo Fénix en curso, que ya no trabe el
   chat mientras usás la app.

5. **2953 — control sin autenticar.** Difícil de forzar a mano; alcanza con confirmar que agregar y hablar
   con un contacto sigue normal, sin que «se conecte al teléfono equivocado».

6. **2954 — lentitud en Bluetooth, al reanudar (tu 2.º diagnóstico).** Dejá un respaldo Fénix en cola, cerrá
   la app o pasala a segundo plano y volvé a abrirla. Al volver, el respaldo ya NO debe re-mandarse a un
   contacto con el Bluetooth atascado y trabar el chat; lo tuyo (texto, foto, archivo) sí se reanuda al toque.

7. **2955 — orden de la lista de contactos (tu captura).** Un contacto agregado de una tarjeta o un grupo ya
   no se queda clavado arriba: en cuanto te escribe (o le escribís) baja a su lugar por el más reciente. El
   recién agregado SIN ningún mensaje todavía sí flota arriba (para que no se pierda). Mirá que «Galaxy» con
   «Ahora» quede por encima de «vivo Y03» con 14 minutos, como esperabas.

8. **2956 — «audio no sale» por internet / lentitud (tus dos diagnósticos del 08-11).** Es la pieza que
   destapa la radio: un respaldo de fondo ya no se queda martillando un contacto con el Bluetooth atascado.
   Prueba: con los dos teléfonos en **WiFi distintas** (solo internet), mandá un **audio** y fijate que salga
   rápido (antes tardaba ~1 minuto y parecía clavado). Probá también con contactos cerca mezclados: que el
   chat no se trabe mientras hay un respaldo Fénix en curso.

9. **2957 — archivos grandes por internet AUTÓNOMOS (lo que pediste: «sin picar reintentar»).** Con los dos
   teléfonos en **WiFi distintas** (solo internet), mandá un **archivo grande** (un APK, un vídeo). Lo que
   tenés que ver: que se mande **solo**, de principio a fin, **sin que te muestre el botón de reintentar ni
   te haga tocar nada**. Puede tardar varios minutos (eso es la velocidad, aparte), pero no debería pedirte
   que lo reinicies. Si el otro contacto se va de internet de verdad, debe quedar en el relojito ⏳ y
   entregarse cuando vuelva. **Honestidad — queda APARTE la VELOCIDAD:** que un archivo de 34 MB tarde ~11
   minutos todavía no se arregló; eso necesita un cambio más grande (mandar el archivo entero a un buzón y que
   el otro lo baje), y lo hacemos en otra ronda. Este build arregla la **autonomía** (que no tengas que picar),
   que era el punto.

10. **2958 — scan rápido, paso 1 (lo que pediste: «el scan tiene que ser rápido»).** Con alguien cerca,
    abrí «Agregar» y fijate dos cosas: (1) que la **búsqueda arranque al toque** (antes, si el teléfono acababa
    de buscar, abrir «Agregar» no hacía nada por unos segundos — eso ya no pasa); (2) que los contactos cercanos
    **vayan apareciendo** en la lista, de arriba hacia abajo (el más cerca arriba), cada uno con sus **barritas
    de señal** (como el wifi: más barras = más cerca), y que la lista **no salte de lugar**. (El **cupo reservado**
    para que nunca diga «Buscando en un momento…» ya está en el 2959, acá abajo.) **Pendiente del mismo plan
    (fase «conectar»):** juntar las conexiones repetidas al mismo contacto (el identificador rotativo). Este build
    es el primer paso del orden del Bluetooth: **descubrir → conectar → enviar**.

11. **2959 — scan rápido, paso 2: cupo reservado (lo que pediste: «cuidado con no sobrepasarte del límite de
    escaneos para que Android no nos tache»).** Difícil de forzar a mano. Alcanza con confirmar que abrir
    «Agregar» **varias veces seguidas** (y con el teléfono reconectando con contactos cerca) la búsqueda
    **arranque siempre al toque**, sin que aparezca el aviso «Buscando en un momento…». Android corta si te
    pasás de ~5 búsquedas en 30 s; antes, el escaneo de fondo (reconexión) podía llenar ese cupo y dejar sin
    hueco a tu búsqueda. Ahora el fondo **se guarda un hueco siempre** para vos, sin pasarse del límite.

## B. Lo que falta, que necesita tu teléfono o una pasada NATIVA (no se puede en el simulador)

Estos NO los subí todavía: o son de la parte nativa (Kotlin), que no se puede probar en el simulador, o
tocan el núcleo (cifrado/conexiones) con poco valor y mucho riesgo de romper lo que anda. Los dejo acá para
hacerlos con cuidado y validarlos contra tu prueba, en vez de arriesgar la base estable.

1. **Bluetooth: juntar las conexiones repetidas al mismo contacto** (por el identificador rotativo había hasta
   4 enlaces a una sola persona). Es el tercer paso de la lentitud. Delicado (decide qué enlaces se
   mantienen), por eso lo hago DESPUÉS de tu prueba de 2951/2952, para validarlo con lo que veas.

2. **F6: que el teléfono no suene por una oferta de llamada falsa** sin verificar (con la app cerrada). Es
   nativo (`BgInbox.kt`); necesita una pasada nativa + prueba tuya de llamadas.

3. **Guardar cifrada la tabla interna número→dirección** (nativo). Bajo valor (solo metadata, no contenido).

4. **Leer por partes los archivos grandes de Wi-Fi Direct** (nativo, robustez de memoria).

5. **Huella de firma oficial en Perfil → Seguridad** (para detectar una copia falsa de la app). Necesita leer
   la firma desde la parte nativa.

6. **Verificar la firma de los eventos de internet y migrar el cifrado viejo E1.** Defensa en profundidad y
   bajo valor (el contenido ya va cifrado de extremo a extremo); es delicado, lo dejo para una ronda cuidada
   aparte para no arriesgar romper la mensajería por internet.

## C. Operativo — esto es tuyo, no es código

1. **Contra una copia falsa de NEXO:** publicar la huella oficial de la app y que la gente instale solo desde
   la fuente oficial.

2. **Contra un ataque al servidor que arma la app (GitHub):** activar el segundo factor en tu cuenta, proteger
   la rama `NEXOCHAT`, y revisar quién puede tocar el flujo que arma la APK. La llave de firma ya la guardás
   vos (no está en el repositorio).

---

Resumen de lo cerrado en esta tanda (todo con batería verde y APK): seguridad — rollback del cifrado (2948),
hombre en el medio al agregar por número (2949), clave «de oídas» de tarjetas/grupos (2950), control sin
autenticar (2953); Bluetooth — Fénix no martilla un enlace atascado (2951) y la regla «el usuario es dueño de
la radio» (2952). El análisis de la lentitud está en `docs/DIAGNOSTICO_BT_LENTITUD_2026-11-07.md` y el de
seguridad en `docs/SEGURIDAD_ATAQUE_2026-11-07.md`.
