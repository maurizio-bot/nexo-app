# Protocolo Fénix — fase 1: la cuenta

Definición del dueño: `docs/NEXO_CONTEXTO.md`, sección 7. Decisiones del 22-10-2026:

| Pregunta | Decisión |
|---|---|
| Qué se protege primero | La **cuenta**: NEXO ID, claves de cifrado (identidad y protocolo 2) y contactos con sus claves. Mensajes y archivos, después |
| Nodos de confianza | Los **contactos**. Automático: al llegar al mínimo de contactos arranca solo; el usuario no hace nada |
| Regla de 10 / 20 | Con **10 contactos**, primera copia (10 fragmentos, uno por contacto). Con **20**, segunda copia (cada fragmento en 2 contactos) |
| Contacto perdido | Si deja de responder al pingeo, se da por perdido y su fragmento se recrea en otro contacto |
| Clave maestra | Aleatoria (256 bits). La huella / Face ID **no** puede recuperarla en un teléfono nuevo (Android nunca entrega la huella; solo abre una llave del chip de ese teléfono): la recuperan los contactos |
| Recuperar en un teléfono nuevo | Los contactos **confirman** ("¿es él / está contigo?"). Con 6 de 10 vuelve la cuenta |

## Cómo funciona

1. **El Sacrificio.** Al tener 10 contactos con NEXO 2714+ (protocolo 2 y `fx:1` en el kx), el teléfono crea la
   clave maestra K, cifra la cuenta con AES-256-GCM (datos adicionales: dueño y versión) y parte K en 10 trozos
   con Shamir **6 de 10** (`src/fenix/shard_crypto.js`). Cada contacto recibe, cifrado de extremo a extremo
   (protocolo 2), **su trozo de K + la copia cifrada de la cuenta**. Con un trozo no se lee nada: hacen falta 6
   contactos juntos. (La cuenta ocupa pocos KB: guardarla entera en cada nodo cuesta lo mismo que trocearla y
   permite recuperarla con cualesquiera 6. Para archivos grandes, fase siguiente, se trocea también el
   contenido.)
2. **La Regla de 20.** Con 20 contactos cada trozo pasa a estar en 2 contactos distintos (gemelos).
3. **El Pingeo.** Una vez al día, cuando el contacto está conectado, el dueño le pide una prueba de que sigue
   teniendo su trozo (`fp` → `fo`: SHA-256 de un número al azar + el trozo + la copia). Sin prueba en
   `lostMs` (7 días por defecto; el pingeo solo funciona con el contacto a alcance) → perdido: su trozo se
   entrega a otro contacto que no tenga ninguno. Si el perdido vuelve, se le pide que borre lo suyo (`fd`).
   Cuando cambian los contactos o sus claves, la copia se rehace (versión nueva) y se reenvía.
4. **El Renacimiento.** En un teléfono nuevo: Perfil → **Recuperar cuenta (Fénix)**. El teléfono busca NEXO
   cerca, se conecta de paso y pide (`fq`). A cada contacto que guarda trozos le sale "Un teléfono nuevo pide
   recuperar su cuenta: ¿quién es?" con las personas cuyos trozos guarda. Al elegir, envía su trozo y la copia
   cifrados para ese teléfono. Con 6 trozos: K → se descifra la cuenta (la autenticación de AES-GCM comprueba
   que todo es correcto) → se escriben NEXO ID, identidad, claves del protocolo 2 y contactos → la app se
   reinicia como el usuario de siempre. Los contactos reciben un kx con `rs` y empiezan sesiones nuevas del
   protocolo 2 (las anteriores se perdieron con el teléfono).

## Límites de esta fase (dichos al dueño)
- Huella / Face ID: protegerán la clave maestra en el teléfono con la fase 3 de seguridad (Keystore); hoy se
  guarda en el almacenamiento interno, como la identidad.
- Pingeo y entrega solo con el contacto conectado directamente (no por Jump todavía).
- Recuperación en persona (los contactos cerca del teléfono nuevo).
- 6 contactos de acuerdo pueden recuperar la cuenta sin el dueño (es el precio de no tener servidor ni frase).
- Mensajes y archivos: fase siguiente.

## Archivos
- `src/fenix/fenix.js` (nuevo, en la APK): todo lo anterior. Estado del dueño en `nexo_fenix.json`; lo que se
  guarda de otros en `nexo_fenix_store.json`.
- Paquetes de control: `fp`, `fo`, `fq`, `fd`. Entregas (`put`) y respuestas de recuperación (`rec`) van como
  archivo con `meta.type = 'fenix'` (flujo fiable de siempre; no se muestran en el chat).
- Pruebas: `tests/sim/fenix.js`.
