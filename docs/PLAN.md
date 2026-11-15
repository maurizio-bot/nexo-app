# NEXO — Plan maestro (meta: EDC México, febrero 2027)

Actualizado: 15-11-2026. Lo lleva Claude: el dueño aporta ideas y decide; Claude ordena, pone fechas y marca ✓ lo hecho.
Se revisa cada fin de semana, junto con la revisión de archivos grandes. Detalle de cada punto: `docs/PENDIENTES.md`.

## La meta
NEXO **publicado en Google Play y funcionando al 100 %** para **EDC México (febrero 2027)**, la primera oportunidad grande de
difusión: en un festival casi no hay señal, que es justo lo que NEXO resuelve. Antes: diciembre listo para la tienda; enero
publicación y primeros usuarios; febrero campaña previa y la prueba de fuego.

## Calendario por etapas

### Etapa 1 — Base sólida (16 al 30 de noviembre)
- [x] Reestructuración del código de la app: ningún archivo de más de 1.000 líneas (los 7, 15-11).
- [x] Reestructuración del puente con Android (4.753 → 844 líneas en 17 archivos; compila, APK 3066). Falta solo que el dueño use la
      3066 con normalidad (si algo del Bluetooth o los avisos se porta raro, decirlo).
- [x] Idiomas: portugués de Brasil y francés; avisos del teléfono en el idioma de la app (APK 3066). Falta mirar en el teléfono que
      los textos largos quepan en los botones.
- [ ] Despertar la app del otro antes de mandarle un archivo grande (hoy se gastan reintentos con apps dormidas).
- [ ] Atascos, lo que falta del plan del 14-11 (aprobado por el dueño): si un contacto con enlace sano no confirma lo tuyo,
      pedir el desatasco desde el que manda y avisar «el teléfono de X no puede leer tus mensajes». Lo demás ya está (ver abajo).
- [ ] Avisos con la pantalla apagada: prueba física del dueño y, si falla, arreglo.
- [ ] Pruebas físicas clave (ver «Lo que te toca»).
- **Cumplido cuando:** batería en verde, índice ≥ 75 y las pruebas físicas clave sin fallos.

### Etapa 2 — Versión para la tienda (1 al 15 de diciembre)
- [ ] Apuntar a un Android más reciente (hoy 14; Play pide más) y probarlo en los teléfonos.
- [ ] Versión de tienda sin actualizador propio ni permiso de instalar apps (Play se encarga de actualizar).
- [ ] Permisos delicados justificados (llamadas a pantalla completa, ahorro de batería, ubicación…) y quitar los que sobren.
- [ ] Firma de publicación con la llave del dueño (Play App Signing).
- [ ] Política de privacidad y términos (página en `nexo-7994a.web.app`, publicada sola desde GitHub).
- [ ] Enlace de invitación desde «Agregar contacto» (WhatsApp, TikTok, «Más») — aprobado por el dueño.
- [ ] Asistente de batería de un toque al instalar.
- [ ] Diagnóstico automático opcional y sin nombres en la versión de tienda.
- **Cumplido cuando:** la versión de tienda pasa la batería y las pruebas físicas.

### Etapa 3 — Google Play (15 al 31 de diciembre)
- [ ] Cuenta de desarrollador del dueño (personal o empresa).
- [ ] Prueba cerrada con al menos 12 personas durante 14 días (si la cuenta es personal y nueva): **empezar a más tardar el 18-12**.
- [ ] Ficha de la tienda: textos en 5 idiomas, capturas, icono, video corto. Sin nombrar otras apps.
- [ ] Nombre en la tienda resuelto (ver decisiones: hay una marca «Nexo» registrada por una empresa cripto).
- **Cumplido cuando:** la prueba cerrada terminó y se puede pedir el paso a producción.

### Etapa 4 — Publicación y primeros usuarios (enero 2027)
- [ ] Paso a producción en Google Play.
- [ ] Modo multitud (cientos de NEXO cerca: primero tus contactos, cuidar batería, saltos para llegar lejos) con prueba en el
      simulador con muchos teléfonos.
- [ ] Punto de encuentro sin señal («¿dónde están?»).
- [ ] Primeros usuarios (familia, amigos, universidad), medidos con los resúmenes diarios (entregas, no instalaciones).
- **Cumplido cuando:** la app está en Play y los primeros grupos la usan entre ellos.

### Etapa 5 — EDC (febrero 2027)
- [ ] Campaña previa: «bájala antes de ir: allá no hay señal»; 3 videos cortos (metro, concierto, punto de encuentro).
- [ ] El día: la gente la usa; diagnósticos y aprendizaje para lo que sigue.
- **Cumplido cuando:** se alcanza la meta de descargas que fije el dueño.

## Después de EDC (ideas guardadas, sin fecha comprometida)
- **iPhone** (2.º trimestre 2027): cuenta Apple (99 USD/año), Mac y iPhones de prueba. Sin iPhone no hay adopción masiva.
- **Pagos:** la fase 1 ya está («Cobro» en el chat, NEXO nunca toca el dinero). Fase 2, pagar con un toque con un socio con
  licencia (Mercado Pago, PayPal): después de constituir la empresa y de una asesoría legal.
- **NEXO Plus** (propuesta 49 MXN/mes) y buzón garantizado con servidor propio para empresas.
- **Entretenimiento:** más juegos entre contactos, stickers y estados más vivos.
- **Stream** (muro tipo TikTok): sin decidir.
- **IA en el teléfono:** idea guardada.
- **Logo y sonidos** elegidos por el dueño: desplegarlos.

## Lo grande que ya está hecho ✓
- ✓ Mensajes por Bluetooth, Wi-Fi, Wi-Fi Direct e internet, con cambio de camino solo y cifrado de punta a punta (también contra
  computadoras cuánticas).
- ✓ Funciona sin internet; saltos de teléfono en teléfono (Jump) y puente a internet a través de un teléfono cercano.
- ✓ Fotos, vídeos, audios y archivos grandes (hasta 1 GB), también por internet y retomando donde iban.
- ✓ Llamadas y videollamadas (1 a 1 y de grupo), dos llamadas a la vez con espera y «Mensaje», compartir pantalla.
- ✓ Grupos, estados, stickers, reacciones, juegos, cobros.
- ✓ Avisos con la app cerrada (despertador por internet), llamada como las del teléfono.
- ✓ Fénix (respaldo repartido entre contactos de confianza) y pasar la cuenta a otro teléfono (falta la prueba física).
- ✓ Actualizador automático con novedades de cada versión; diagnóstico automático y resumen diario.
- ✓ Servidores de paso de reserva (si uno falla, otro en segundos).
- ✓ Atascos (tras el bucle del APK de 25 MB del 10-11): envíos de a uno y que siguen donde iban (2995–3007); un mensaje que
  espera no gasta reintentos (2993); sobre un Bluetooth caído o una app congelada queda en espera, no fallido (3002, 3009);
  desatasco automático, también en grupos (3069, 3071); Bluetooth solo de emergencia y solo a quien está cerca (3079, 3084); un
  archivo que va por Bluetooth se pasa a mitad al Wi-Fi o a internet (3080).
- ✓ 5 idiomas: español, italiano, inglés, portugués de Brasil y francés (APK 3066), también en los avisos del teléfono.

## Decisiones del dueño (en orden de urgencia)
1. **Cuenta de Google Play: personal o empresa** (antes del 15-12). Una empresa hay que constituirla (lleva semanas).
2. **Nombre en la tienda:** «Nexo» está registrado como marca de software por una empresa cripto en EE. UU. y hay una app
   «Nexo» en Play. Conviene decidirlo pronto (cambiarlo después cuesta más).
3. **Fecha exacta de EDC 2027** y **meta de descargas** para el evento.
4. **Seguridad:** revisar adjuntos por su contenido real; relleno de mensajes en los puentes; comprobar identidad en la Wi-Fi;
   «Rechazar» firmado; confirmaciones firmadas.
5. **Privacidad del proyecto en GitHub** (recomendación: documentos de negocio a privado; el código puede seguir público) y la
   cuenta «noone4224» con permiso de escritura.
6. **Pagos:** país (México), empresa y socio — después de EDC.

## Lo que te toca (pruebas físicas, lista corta)
1. **Avisos con la pantalla apagada**: mensaje a un teléfono bloqueado con la app cerrada (es lo que más baja el índice).
2. **Llamadas de voz** por Bluetooth y por Wi-Fi, fijándote en el eco.
3. **Cuenta:** recuperar con Fénix, pasar la cuenta a otro teléfono y el bloqueo de la app (nunca probados).
4. **Grupos:** mensajes de grupo y una llamada de tres.
5. **Lo nuevo** (pruebas 67 a 72 de `docs/PRUEBAS_FISICAS.md`).

## Índice de robustez
- 15-11: **66,1 → 70,5** al contar como pruebas reales lo que muestran los diagnósticos de esta semana (criterio del dueño):
  Bluetooth, archivos y Wi-Fi Direct pasan a «confirmado»; llamadas y grupos a «reciente»; avisos de «falla» a «antes» (falta
  la prueba con la pantalla apagada).
- Metas: **≥ 75** al cerrar la etapa 1; **≥ 80** antes de Google Play.
