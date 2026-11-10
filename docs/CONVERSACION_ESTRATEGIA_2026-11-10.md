# NEXO — Conversación de estrategia con el dueño (10-11-2026)

Contexto: el dueño tenía solo el S24 (la tablet y el vivo se quedaron en la oficina) y quiso aprovechar para dos cosas:
pulir lo que se puede con un solo equipo y **platicar de NEXO a nivel de visión**, porque «hemos sido muy rápidos» y faltaba
la parte de análisis. Este documento guarda lo hablado para no perderlo. Lo que dijo el dueño va entre comillas; lo que
sigue de Claude va marcado. Complementa `PLAN_NEGOCIO.md` (que ya tiene precios, escenarios y etapas) y `DICIEMBRE.md`.

## 1. Qué sería «valió la pena» para el dueño
- Que NEXO sea **un producto oficial, de uso cotidiano y por todos**, y que le dé un beneficio económico con el que pueda
  «vivir bien».
- El momento fundacional que recuerda: la primera vez que le mandó un mensaje a alguien, sin que estuviera planeado (era
  una prueba), y **llegó**. Empezó en diciembre de 2025. Antes de este proyecto trabajó con otra inteligencia artificial.
- Lectura de Claude: ese «llegó» es el valor central de la app. Todo lo demás es secundario. La métrica que importa no es el
  número de funciones sino **cuántos mensajes de cada cien llegan rápido, en condiciones reales y con gente que no es el
  dueño**. El diagnóstico automático (2974) ya es la base para medirlo, cuidando la privacidad.

## 2. Lo que el dueño NO quiere
- **Presionar a la familia ni a los amigos** con «usá mi app en vez de WhatsApp». Ya lo intentó y no le gusta.
- **Premios por invitar** (por ejemplo, un sticker a cambio): «no es algo de haz algo y te doy un premio; es la
  recomendación de una persona hacia otra».
- Su referencia: Facebook. Una prima le dijo «es el bueno, pruébalo», y la gente lo usó porque tenía **algo que antes no
  existía** (buscar a la persona por su nombre real). Quiere para NEXO «ese plus, ese algo que no existe y por eso lo
  quieres usar, porque te ayuda».
- Apunta al **público general**, publicado en Google Play, esparciéndose solo.

## 3. Lectura de Claude (opinión, para discutir)
- Facebook no empezó con «todos»: empezó dentro de una universidad, donde todos se conocían. El plus se sintió el primer día
  porque la red era densa y pequeña.
- **El efecto red de NEXO es local**: no necesita que estén todos tus contactos, solo la gente que está contigo en ese
  lugar. Eso permite sembrar zonas pequeñas y densas en vez de conquistar el mundo de golpe.
- **Seguro contra hábito**: un mensajero sin infraestructura se necesita pocas veces (seguro). Para ser hábito diario
  necesita un lugar donde la infraestructura falle todos los días: almacenes, fábricas, hospitales, obras, tiendas grandes,
  campus. Por eso la idea de empresas del dueño es la más sólida.
- Las dos promesas de NEXO piden prioridades distintas: «funciona donde no hay infraestructura» (premia Bluetooth y malla) y
  «reemplazo de WhatsApp sin servidor» (premia continuidad, que es lo que da un servidor). Conviene decidir cuál va primero.
- Preocupaciones: ancho contra hondo (índice de robustez 62,5 de 110 con muchas funciones), parches locales sobre archivos
  ya enormes (quizá toque una fase de simplificar), simulador contra realidad (lo importante lo encontraron los
  diagnósticos reales) y la memoria entre sesiones, que vive solo en estos documentos.

## 4. Ideas

### 4.1 Plan de pago con buzón garantizado (idea nueva de hoy)
El dueño: «me encantó la idea, tiene mucho sentido y tiene sustentabilidad. **Guárdala bien, que no se nos olvide.**»
- **Qué es:** un servicio OPCIONAL de pago, pensado sobre todo para empresas, en el que NEXO pone un servidor propio
  (un relé con buzón de retención larga) para que el mensaje «nunca se caiga», como WhatsApp. Es justo la brecha que NEXO no
  puede cerrar solo con teléfonos: continuidad.
- **Por qué encaja:** hoy el buzón de internet usa relés públicos de Nostr (`src/net/net_link.js`, caducidad de 7 días) y el
  toque FCM despierta al otro teléfono. El plan agrega un relé propio de NEXO con retención larga, disponibilidad 24/7,
  prioridad en el toque y cuenta u organización autenticada. Existe el precedente de relés de pago en el ecosistema Nostr.
- **Dónde va en el plan de negocio:** como parte de **NEXO Equipos** (3 USD por usuario al mes en `PLAN_NEGOCIO.md` §4) y
  como extra de **NEXO Plus**. La app y lo esencial siguen gratis y sin servidor.
- **Qué hay que decidir y vigilar:** debe seguir siendo opcional (si fuera obligatorio contradice «sin servidores»); el
  cifrado de extremo a extremo hace que el servidor solo vea mensajes cifrados, pero sí vería metadatos (quién, cuándo);
  tiene costes de infraestructura y soporte 24/7; hay que revisar obligaciones sobre datos según el país.
- **Siguiente paso:** diseño técnico corto (cómo se autentica una organización, cómo se elige el relé propio, qué se
  promete exactamente) y precio. No hay código todavía.

### 4.2 Siembra en universidades (idea del dueño)
Pasar la app a conocidos y amigos que van a universidades y que ellos la compartan, para probarla. Coincide con los
«núcleos» de `PLAN_NEGOCIO.md` y con el modo en que empezó Facebook. Antes de hacerlo conviene tener claro:
- **iPhone:** NEXO es solo Android. En una universidad hay bastantes iPhone y ahí la siembra choca con un muro
  (`IOS_PROPUESTA.md`). Elegir grupos con mayoría Android o asumir esa pérdida.
- **Instalación:** hoy es un APK de depuración descargado de GitHub. Instalar requiere permitir «apps desconocidas».
- **Consentimiento del diagnóstico automático:** está encendido por defecto, avisa la primera vez y manda a la bandeja del
  desarrollador un texto que incluye identificadores de sus contactos. Con probadores externos, decidir (pendiente del
  dueño) si queda encendido o apagado con una pregunta única, y explicarlo claro.
- **Qué medir:** que el mensaje llegue y cuánto tarda, no cuántas personas la instalan.
- **Sin presionar:** ofrecerla y dejar que se difunda sola, como el dueño quiere.

### 4.3 Empresas y eventos
El dueño ve una ventaja frente a WhatsApp en empresas con empleados en el mismo edificio o almacén. Ya está en el plan como
NEXO Equipos. **Todavía no conoce una empresa ni un evento para un piloto.** Un piloto de 10 a 20 personas durante un mes
daría casos reales, diagnósticos de gente que no es el dueño y la métrica de entrega. Falta la administración (altas, bajas,
grupos por área), que sin servidor es un reto de diseño y que el plan de pago de 4.1 ayudaría a resolver.

### 4.4 Difusión sin internet (idea de Claude, sin validar)
Apps como SHAREit y Xender crecieron pasándose la app de teléfono a teléfono sin internet. El envío del APK de 25 MB entre
los teléfonos del dueño es el prototipo de ese ciclo. Habría que revisar qué permite la política de Google Play.

## 5. Google Play: qué falta (resumen; la etapa 0 de `PLAN_NEGOCIO.md` tiene más)
- Compilación de producción firmada (hoy se publica un APK de depuración) y formato AAB.
- Política de privacidad y formulario de seguridad de datos, **incluyendo el diagnóstico automático** (registros de fallos y
  diagnóstico).
- Justificar permisos delicados (Bluetooth, ubicación, servicios en primer plano de micrófono y cámara, exención de batería,
  pantalla completa).
- La regla que Claude conoce: las cuentas personales nuevas deben hacer una prueba cerrada con al menos 12 testers durante
  14 días antes de producción. **Verificarla, puede haber cambiado.**
- **Riesgo de marca:** «Nexo» es una empresa de criptomonedas con marcas registradas (`PLAN_NEGOCIO.md` §6). Hacer la
  búsqueda de marca antes de publicar.
- Google Play no hace viral nada: es la puerta, no el motor.

## 6. Hilos que quedaron por platicar
- El dueño dijo que se le fue una pregunta que quería hacer; se retoma cuando se acuerde.
- ¿Cuál es «el plus» de NEXO para una persona común, en una frase? Candidatos: funciona sin internet, sin número de
  teléfono, encontrar gente cercana sin intercambiar contactos.
- Qué va primero: la promesa «sin infraestructura» o la de «continuidad como WhatsApp».
- Simplificar antes de agregar: una fase de limpieza de los archivos más grandes.
- Si se abre el código (licencia libre) para confianza y subvenciones (`PLAN_NEGOCIO.md` §8).

## 7. Qué se puede hacer con un solo teléfono (S24)
- Pulido: cargar las fotos HD del chat de forma perezosa (hoy cada foto grande se lee del disco al pintar el chat, unos
  450 ms cada una), notificación con solo el iconito (A1), pasada de usuario nuevo por Perfil y Ajustes.
- Pruebas de las builds 2976 y 2977 que no necesitan segundo equipo: §A.29 y §A.30 de
  `PRUEBAS_FISICAS_PENDIENTES_2026-11-08.md`.
- Preparar la ruta a Google Play: compilación de producción firmada, borrador de política de privacidad, lista de permisos.

## 8. Problemas y soluciones a los que se llegó (segunda parte de la conversación)
- **Cómo consigue hoy el dueño sus diagnósticos:** pasa la app a compañeros del trabajo y les pide que se metan y le manden el
  diagnóstico; él lo copia y lo pega a Claude. Nadie la usa entre ellos (el dueño tiene que forzarlos, no le ven propósito) y
  muchos no actualizan. La novia la usa poco con sus hijos.
- **Problemas:** poco uso, poca comunicación de los usuarios para saber qué analizar, poco testeo físico.
- **Soluciones acordadas:** diagnóstico automático de punta a punta (resumen diario + canal directo a Claude) y actualizaciones
  automáticas. Detalle y orden en `PENDIENTES.md` ⭐.
- **Dos correcciones del dueño a Claude:** (a) el diagnóstico automático llega a su bandeja sin que el otro haga nada, pero el
  tramo bandeja → Claude lo hace él a mano; (b) la frase «tipo WhatsApp pero mejor» es solo lo que le dice a un compañero para
  que la pruebe, no su estrategia, y sus ideas técnicas (usuario primero, internet antes que un Bluetooth muerto, el propio
  diagnóstico automático) han sido de lo mejor del proyecto.
- **Cola de pulido** para cuando el dueño no tiene tiempo: `COLA_DE_PULIDO.md`.
