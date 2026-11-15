# NEXO — Difusión (cómo hacer que la gente se pase)

Pedido del dueño (15-11): «hay que empezar a pensar en la difusión y hay que tomar en cuenta todo». Parte del análisis de Grok («cómo
pasar a un usuario de WhatsApp a NEXO»), revisado contra lo que la app hace HOY (código y pruebas), más lo que coincidimos el dueño y
Claude el 15-11 (prueba del «usuario normal»). Antecedentes: `docs/DICIEMBRE.md` (lo que frena el lanzamiento) y
`docs/CONVERSACION_ESTRATEGIA_2026-11-10.md` §4.4.

## 1. Principios (válidos)
- **No atacar a WhatsApp.** La gente lo usa porque funciona y todos están ahí; si se le critica, se cierran.
- **Complementar, no reemplazar:** «No te pido que cambies; te pido que la tengas instalada. El día que no haya señal, vas a agradecer
  tenerla». Es el mejor cierre.
- **Situaciones concretas** donde las otras apps no funcionan y NEXO sí (ver §2), no discursos.
- **Honestidad sobre el inicio:** al principio solo sirve con quien también la instale. No venderla como reemplazo total (falta
  iPhone, falta estar en la tienda, falta gente).
- **La metáfora del 4x4:** «WhatsApp es el auto de diario; NEXO es la camioneta 4x4: no la usas para ir al súper, pero cuando la
  necesitas, no hay otra».
- **Empezar por grupos chicos completos** (la familia, los amigos cercanos, un equipo de trabajo): un grupo entero que la usa vale más
  que cien sueltos.

## 2. Argumentos, con lo que es verdad hoy
| Argumento | Estado real (15-11) |
|---|---|
| Sin señal: textos, fotos, archivos, notas de voz y **llamadas de voz** por Bluetooth con quien está cerca | Verdad (probado en teléfonos). |
| **Videollamada sin internet** | Solo con la misma Wi-Fi (aunque esa Wi-Fi no tenga internet). Por Bluetooth es **solo voz**: Grok se pasó al decir videollamadas por Bluetooth. |
| Archivos grandes rápidos entre teléfonos cercanos | Verdad: Wi-Fi Direct funcionó S23↔S24 el 15-11 (373 KB en 5 s). |
| Cifrado de extremo a extremo y **contra computadoras cuánticas** | Verdad en el código (ML-KEM-768, como el PQXDH de Signal), cuando los dos tienen versión reciente. |
| Sin número de teléfono (tu identidad es tu NEXO ID) | Verdad. |
| «Nadie guarda con quién hablas» | Casi: no hay servidor propio; por internet se usan relés públicos que no leen el contenido; con «Usar Tor siempre» tampoco ven desde dónde. Decirlo así, sin exagerar. |
| Recuperar la cuenta con contactos de confianza (Fénix), sin número ni 12 palabras | Existe y pasa en el simulador, pero **nunca se probó en teléfonos**. No anunciarlo hasta la prueba física del dueño. |
| Copia de los chats repartida entre gente de confianza | Lo mismo que Fénix: no anunciar hasta probarlo. |

## 3. Qué NO decir
- En la **ficha de Google Play no nombrar a WhatsApp** ni a otras apps (sus reglas lo vigilan): «cuando las otras apps no funcionan».
- No usar «protestas» en el material oficial: llama la atención equivocada. Mejor metro, conciertos y estadios, sismos y apagones,
  montaña, viajes, zonas sin cobertura.
- No prometer «imposible de hackear» ni «seguridad absoluta».
- No prometer iPhone hasta que exista.
- **Español de México**, no rioplatense: «puedes», «mira», «chamba» (el texto de Grok usaba «podés», «mirá», «laburo»).

## 4. Lo que falta ANTES de una difusión amplia (en orden)
1. **Avisos que llegan siempre** con la pantalla apagada (hoy el área marcada en falla: espera la prueba física).
2. **Enlace de invitación** desde «Agregar contacto» (WhatsApp, TikTok, «Más»). Decisión del dueño: página web gratis en GitHub
   (pública) o dominio propio.
3. **Estar en Google Play:** instalar un archivo con «apps desconocidas» asusta.
4. **Asistente de batería** de un toque al instalar (que nadie pierda avisos por el ahorro de batería).
5. **Portugués y francés,** si se apunta fuera de México.
6. **iPhone** (más adelante: sin él, media oficina se queda fuera).

## 5. Etapas
- **Ola 1 (ahora):** probadores (familia y amigos del dueño).
- **Ola 2:** cuando estén los puntos 1 a 3, grupos chicos completos (una familia entera, un equipo de trabajo).
- **Ola 3:** tienda + TikTok, con videos cortos.

## 6. Mensajes listos (México)
- **Invitación corta (la que va con el enlace):** «Te invito a NEXO: mensajes y llamadas aunque no haya señal, sin número de teléfono y
  cifrado de punta a punta. Toca aquí para agregarme: [enlace]».
- **En persona:** «No te digo que borres WhatsApp. Pero hay ratos en que no existe: sin señal, sin datos, en el metro o en un temblor.
  NEXO funciona igual, por Bluetooth con quien está cerca, y no pide tu número. Al principio solo sirve con quien la tenga, por eso te
  la paso. Tenla instalada: el día que la necesites, vas a entender para qué existe».
- **TikTok (ideas de 15 s, para el dueño):** (1) el metro sin señal: «se fue la señal… y el mensaje llegó igual»; (2) concierto o
  estadio lleno: foto al amigo que está a unos metros sin internet; (3) simulacro de sismo: «estoy bien» a la familia sin red.

## 7. Decisiones del dueño
- Página web del enlace: GitHub gratis (pública) o dominio propio (costo anual).
- Cuándo subir a Google Play y con qué nombre y textos en la ficha.
- Presupuesto y tono de los videos.
