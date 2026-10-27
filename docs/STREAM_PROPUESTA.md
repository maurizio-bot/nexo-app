# NEXO — Stream (pantalla infinita): propuesta para decidir

Pedido del dueño (#95): una "pantalla infinita" tipo TikTok + estados de contactos. Está **SIN DECIDIR** (sí/no; solo
cercanos o con servidor). Esto NO es código todavía: es la propuesta para que el dueño decida el camino. Nada de esto
cambia la app hasta que él elija.

## 1. La decisión de fondo (igual que en el #87)
Un "Stream" necesita dos cosas que NEXO, al ser P2P sin servidores, no tiene gratis: **dónde vive el contenido** y
**cómo se descubre**. Hay tres caminos, y el dueño tiene que elegir uno:

- **(A) Solo cercanos / P2P puro (sin servidor).** Ves el Stream de los contactos que están a tu alcance ahora
  (Bluetooth/Wi-Fi/Jump) o cuyo contenido ya sincronizaste. **Pro:** cero servidores, privado, 100% NEXO. **Contra:**
  feed pobre (solo contactos cercanos/en línea), nada "infinito", y si el contacto no está, no ves lo suyo.
- **(B) Con el buzón de los relés (lo que ya existe).** Cada uno publica sus estados/clips **cifrados** como eventos en
  los relés (como los mensajes por internet); los contactos los bajan cuando abren. **Pro:** funciona aunque no estén
  cerca, dura ~1 día, sin servidor propio. **Contra:** los relés aguantan clips **cortos** (mismo límite que los
  archivos por internet: ~6 MB; lo grande solo por Tor/Wi-Fi), y es solo entre **tus contactos** (no extraños).
- **(C) Con servidor propio (tipo TikTok de verdad).** Un servidor que aloja el feed y lo reparte. **Pro:** feed
  infinito real, descubrimiento de gente nueva. **Contra:** rompe "sin servidores", cuesta hosting, obliga a
  **moderación** (contenido público = responsabilidad legal) y cambia la naturaleza privada de NEXO. Es un producto
  distinto.

La tensión es la misma del #87: **lo "infinito/global" necesita un servidor (C)**; sin servidor, el Stream es
necesariamente **entre contactos** (A o B).

## 2. Recomendación: empezar por "Estados" entre contactos (sin servidor, sin decisión grande)
Lo más parecido a lo que ya domina NEXO y lo más útil sin comprometer nada:

- **Fase 1 — Estados (como los de WhatsApp), E2E, 24 h.** Un contacto publica un estado (texto, foto, o clip corto) que
  sus contactos ven en una tira "Estados" y que **caduca a las 24 h**. Viaja por lo que ya hay: en vivo por
  Bluetooth/Wi-Fi/Jump, y por el **buzón de los relés** para quien no esté (modelo B). Es, técnicamente, **un tipo de
  mensaje con caducidad** (como el "cobro" o la ubicación): no hace falta servidor ni arquitectura nueva. Privado entre
  contactos. Riesgo bajo, verificable en el simulador.
- **Fase 2 — Mini-feed de clips de contactos.** La "pantalla infinita" pero **solo de tus contactos**: se desplaza por
  los estados/clips recientes de la gente que tenés agregada. Gestos del dueño (de sus notas): tocar arriba-izq =
  vídeos, arriba-der = estados; doble toque = me gusta; deslizar der→izq = comentarios; izq→der = volver. Sigue sin
  servidor (contenido de contactos, por buzón/en vivo). Clips cortos (límite de relés) salvo que estén cerca/por Tor.
- **Fase 3 (OPCIONAL, decisión del dueño) — feed público/global.** Solo si quiere descubrimiento de desconocidos: eso
  **sí** necesita servidor (C), moderación y un modelo de negocio/legal. Es un salto grande; recomiendo no hacerlo sin
  una decisión explícita.

## 3. Privacidad (importante)
Los estados/clips son personales. En A/B van **cifrados solo a tus contactos** (como los mensajes), no públicos. Un feed
público (C) significaría contenido sin cifrar y visible para cualquiera → moderación y responsabilidad. Mi recomendación
es mantener el Stream **entre contactos y cifrado** salvo que el dueño quiera explícitamente lo público.

## 4. Qué necesito del dueño para empezar a programar
1. **¿Arrancamos por "Estados" entre contactos (Fase 1, sin servidor)?** (es lo que recomiendo).
2. **¿El Stream es solo de contactos (A/B) o querés feed público con servidor (C)?** (C es otro proyecto).
3. ¿Qué querés en un estado: texto, foto, clip corto, los tres? ¿Caduca a 24 h como WhatsApp?

Con eso, la Fase 1 es un bloque acotado y verificable (un tipo de mensaje con caducidad + una tira de "Estados"), al
estilo de lo que ya hicimos con cobros y ubicación.
