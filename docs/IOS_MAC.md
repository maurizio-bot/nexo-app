# NEXO — Qué MacBook necesito para empezar con iOS (para el Buen Fin)

> Resumen rápido: **para iOS SÍ o SÍ hace falta una Mac** (Xcode solo corre en macOS). Para lo que necesita NEXO
> (es una app **Capacitor** = un envoltorio nativo liviano + la web; el build NO es pesado como un juego nativo),
> con una **MacBook Air con chip Apple (M4 o M5), 16 GB de RAM y 512 GB de disco** vas sobradísimo. Lo que de verdad
> aprieta no es el chip, es el **disco** (Xcode + los simuladores de iPhone comen 60-100 GB).

## Lo que de verdad importa para desarrollar iOS (en orden)
1. **Chip Apple (M-algo), NO Intel.** Cualquier Mac con chip M (M1 en adelante) sirve. Las Intel viejas quedaron atrás.
2. **Disco ≥ 512 GB.** Es lo que más aprieta: macOS (~30 GB) + Xcode (~40 GB) + simuladores de iPhone (10-30 GB) +
   el proyecto. Con 256 GB se puede, pero vivís borrando cosas. **512 GB es el punto dulce.**
3. **RAM 16 GB.** Buena noticia: desde el **M4, TODAS las MacBook Air traen 16 GB de base** (antes el base era 8 GB).
   16 GB alcanza de sobra para Xcode + un simulador + el navegador. 8 GB se puede pero es sufrido → evitá los 8 GB.
4. El chip exacto (M3 vs M4 vs M5) es lo de MENOS para NEXO. Un M3 ya compila esto en segundos.

## Las 3 opciones (con precios de referencia en México, nov. 2026)

> Los precios de Apple son de lista; en tiendas/Mercado Libre y **reacondicionados** bajan bastante, sobre todo en el
> **Buen Fin**. Fuentes de precios abajo.

### 🟢 Base BUENA (lo mínimo que te recomiendo) — ~$25.000–28.000 MXN
- **MacBook Air M4, 16 GB / 256 GB** (13"). O un **M4 reacondicionado**, o un **M3 pero SOLO en versión 16 GB**
  (el M3 de base es 8 GB → ese NO).
- Corre Xcode y compila NEXO sin drama. El único pero: **256 GB de disco** → vas a andar justo (se tapa con un SSD
  externo barato para guardar lo que no sea Xcode).
- **Ideal si aparece en oferta del Buen Fin o reacondicionado.**

### 🔵 BUENA — el punto dulce (lo que yo compraría) — ~$30.000–33.000 MXN
- **MacBook Air M4 (o M5), 16 GB / 512 GB** (13").
- Los **512 GB** sacan el único dolor de cabeza (Xcode + simuladores + el repo entran cómodos). RAM cómoda.
- **La mejor relación precio/tranquilidad para iOS a largo plazo.** Si el M5 está casi al mismo precio que el M4, M5;
  si el M4 está rebajado, M4 (para NEXO rinden igual).

### 🟣 EXCELENTE (futuro a prueba / si sobra presupuesto) — ~$45.000+ MXN
- **MacBook Pro M4 Pro (o M5 Pro), 24 GB+ / 512 GB–1 TB**.
- Compila más rápido, aguanta varios simuladores + probar **llamadas/vídeo** con holgura, pantalla mejor.
- Para NEXO es **más de lo necesario**, pero si pensás en años y en la parte de vídeo/llamadas, es la tranquila.

## 💡 Alternativa más barata que quizás no pensaste: **Mac mini M4**
- Si tenés (o conseguís) **monitor + teclado**, un **Mac mini M4 (16 GB / 256–512 GB)** sale **bastante más barato que
  cualquier MacBook** (base ~$14.000–18.000 MXN) y para desarrollar iOS en el escritorio es **igual de capaz**.
- Desventaja: no es portátil. Pero para «empezar con iOS sin gastar de más», es la opción más inteligente en precio.

## ⚠️ Gastos que SÍ o SÍ hay que sumar (además de la Mac)
- **Cuenta de Apple Developer: USD 99/año** (~$1.900 MXN). Hace falta para TestFlight (probar con gente) y para subir a
  la App Store. Sin pagarla podés probar en TU iPhone con límites (perfil que caduca cada 7 días).
- **Un iPhone de verdad para probar** (el simulador no prueba Bluetooth real, que es el corazón de NEXO). Si no tenés,
  un **iPhone usado/reacondicionado** sirve para desarrollo.

## Mi recomendación concreta para el Buen Fin
1. **Primera opción:** cazar una **MacBook Air M4 16/512 en oferta** (la 🔵 «buena»). Es la que no te va a quedar chica.
2. **Si el presupuesto aprieta:** **Mac mini M4 16/512** (si tenés monitor) o **MacBook Air M4 16/256** reacondicionada.
3. **Evitá:** cualquier cosa con **8 GB de RAM**, los **256 GB** si podés estirarte a 512, y las **Intel viejas**.
4. **Dónde mirar reacondicionados confiables:** la tienda de reacondicionados de Apple, y vendedores con reputación en
   Mercado Libre/Amazon. En el Buen Fin, los **M3/M4 en liquidación** suelen ser el mejor precio por lo que rinden.

> Nota honesta: el salto a iOS no es solo la Mac. Es **reescribir el plugin Bluetooth nativo en Swift** (hoy es Kotlin
> para Android) — ese es el trabajo grande de iOS, no el equipo. La Mac es solo la herramienta para poder empezar.

---

### Fuentes de precios (México, 2026)
- [MacBook Air M4: precios en México — El Universal](https://www.eluniversal.com.mx/techbit/macbook-air-m4-cuales-son-sus-precios-en-mexico/) (M4 13" desde ~$24.999; base 16 GB)
- [Nueva MacBook Air M3: precios en México — Xataka México](https://www.xataka.com.mx/ordenadores/nueva-apple-macbook-air-chip-m3-lanzamiento-precio-mexico-caracteristicas-especificaciones-ficha-tecnica) (M3 13" 8/256 desde ~$22.999)
- [MacBook Air M4 — Mercado Libre México](https://listado.mercadolibre.com.mx/macbook-air-m4) (M4 13" 16/256 ~$27.999 en vendedores)
- [MacBook Air M3 512 GB — Amazon México](https://www.amazon.com.mx/macbook-air-m3-512gb/s?k=macbook+air+m3+512gb) (incl. M5 2026 y M4 reacondicionados)
- [MacBook Air 13"/15" con M3 — MacStore Online](https://www.macstoreonline.com.mx/colecciones/macbook-air) (referencia tienda MX)
