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
