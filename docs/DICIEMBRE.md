# NEXO — Plan honesto para lanzar en diciembre

> Contexto (dueño, 03-11): «tenemos la utilidad pero falta el **entretenimiento** (con qué pegamos al user a la app) y la
> **parte monetaria**. No cantemos victoria.» Totalmente de acuerdo. Acá, sin humo, qué falta de verdad y qué haría.

## Dónde estamos parados (honesto)
- **Utilidad: fuerte.** Mensajería P2P, offline, archivos/vídeo, llamadas locales, **despertador FCM (probado)**, cifrado
  E2E, Fénix, grupos, Telecom/coche. En el nicho «funciona con y sin internet» NEXO ya es superior a la competencia.
- **Lo que FRENA el lanzamiento no son más features, son 2 cosas:**
  1. **Retención (entretenimiento):** hoy la app es una *herramienta*. La gente abre WhatsApp 30 veces al día por lo
     *social*, no por la utilidad. Sin un gancho de volver, se instala y se olvida.
  2. **Monetización:** no hay un modelo decidido todavía.
- Y un tercero silencioso: **validación en teléfonos reales** (el «índice de robustez» ~54/100 lo frena esto). Ver
  `docs/PRUEBAS_FISICAS.md`.

## 1) Entretenimiento — qué pega al user (ordenado por costo/beneficio)
La clave: dar **razones de volver** que la competencia offline no tiene. De más barato a más grande:

- 🟢 **Juegos P2P entre contactos (BARATO, alto enganche).** Ya hay motor (tres en raya 2830, Defensor NEXO 2806). Sumar
  **conecta-4, batalla naval, damas** con el MISMO motor es muy barato y es *social* (jugás con tu contacto). *El dueño ya
  dejó conecta-4 marcado como candidato (#123).* → **Mi recomendación #1 para diciembre.**
- 🟢 **Stickers/reacciones más ricos.** Ya hay stickers (2829) y reacciones (2785). Packs propios + reaccionar con
  cualquier emoji + «tu cara» sticker. Barato, muy usado.
- 🟡 **Estados/Stories más vivos.** Ya hay estados entre cercanos (2804). Hacerlos tipo «historias» (ver quién vio, 24 h,
  responder al estado) da el bucle social de Instagram en chico. Medio.
- 🟡 **Stream / muro (#95).** El feed infinito entre contactos. Es el gancho MÁS fuerte pero el MÁS grande de construir
  bien. Para diciembre: una **v1 chica** (ver publicaciones de contactos cercanos, like, comentar) en vez de todo.
- 💡 **El diferenciador real:** «entretenimiento que funciona SIN internet» (jugar, mandar stickers, ver estados en un
  concierto/avión/subte donde WhatsApp no anda). Eso NADIE lo tiene. Vale la pena que el marketing lo grite.

**Para diciembre yo haría:** 2–3 juegos P2P más (baratos) + reacciones/stickers ricos. Es lo que da enganche YA sin un mes
de desarrollo. El Stream v1 si queda tiempo.

## 2) Monetización — la verdad incómoda
Esto **no es código que yo pueda «terminar» solo** — es una **decisión de negocio tuya**. Las opciones reales, honestas:

- **A) Gratis al principio (network effect primero).** Lo más sensato para un lanzamiento: crecer usuarios, monetizar
  después. Una app de mensajería sin usuarios no monetiza nada. **Mi recomendación para diciembre.**
- **B) «NEXO Pro» de pago único.** Desbloquear extras (más fondos, packs de stickers, más juegos, más almacenamiento de
  vault). Problema: NEXO está **fuera de Play Store**, así que cobrar necesita un rail de pago (ver abajo). Técnicamente
  es fácil una vez que hay con qué cobrar.
- **C) Recargas de celular / pagos (#105).** Es lo que tenías en mente, pero **necesita un socio/proveedor** (una
  pasarela o un distribuidor de recargas). Sin eso, solo podemos mover «mensajes de datos de pago», no cobrar de verdad.
  Es la monetización más fuerte pero la que **más depende de un tercero** → decisión/gestión tuya, no código.
- **D) Play Store.** Si entrás a Play Store, se abre el cobro de Google (suscripciones/compras). Pero implica política de
  privacidad, justificar permisos BLE/ubicación, y perder algo del «soberano». Es una decisión estratégica.

**Lo que puedo hacer yo sin decisión tuya:** dejar la **plomería lista** (un «NEXO Pro» con extras bloqueados/desbloqueados
por una bandera local) para que, el día que elijas el rail de cobro (B/C/D), activarlo sea un paso chico. **Lo que NO puedo
hacer solo:** elegir el modelo ni conseguir el socio de pagos — eso es tuyo.

## Mi propuesta de prioridades para diciembre
1. **Cerrar la validación real** (las pruebas de `docs/PRUEBAS_FISICAS.md`) — sin esto, lanzar es arriesgado.
2. **Entretenimiento barato y sticky:** 2–3 juegos P2P más + stickers/reacciones ricos. (Puedo empezar cuando me digas
   cuáles — o arranco con **conecta-4** que ya habías marcado.)
3. **Dejar la plomería de «Pro»** lista para cuando decidas el modelo de cobro.
4. **Vos** (en paralelo, no es código): decidir el modelo de monetización (A/B/C/D) y, si es C, buscar el socio de pagos.

> Resumen sin humo: la utilidad está. Para diciembre lo que mueve la aguja es **enganche (juegos/stickers) + validar en
> teléfonos**, y **decidir** el modelo de plata (que es tuyo, no mío). No cantamos victoria — pero estamos cerca si
> enfocamos en esto y no en más features de utilidad.
