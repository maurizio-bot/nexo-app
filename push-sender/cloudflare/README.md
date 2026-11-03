# NEXO — Despertador en Cloudflare Workers (GRATIS, sin tarjeta)

Alternativa a Firebase Functions para quien **no quiere activar Blaze / poner tarjeta**. Hace lo mismo: recibe
`POST { "to": "<token FCM>" }` y le pide a Firebase (FCM) que despierte ese teléfono. **El despertar lo sigue
haciendo Firebase**; esto solo se lo pide, firmando con la cuenta de servicio del proyecto `nexo-7994a`.

- **Costo: $0** (plan gratis de Cloudflare: 100.000 pedidos/día; esto usa muchísimo menos).
- **Sin tarjeta, sin facturación** → no aparecen los errores de billing de Google.
- La criptografía (firma del token de Google) está **probada**: `node push-sender/cloudflare/test_sign.mjs`.

## Pasos (una vez, ~10 min, en 2 lugares: consola de Firebase y Cloudflare)

### 1) Bajar la «llave» de Google (gratis, NO necesita Blaze)
1. Entrá a **console.firebase.google.com** → proyecto **nexo-7994a**.
2. Arriba a la izquierda, ⚙️ **Configuración del proyecto** → pestaña **Cuentas de servicio**.
3. Botón **Generar nueva clave privada** → **Generar clave**. Se descarga un archivo **`.json`**. Guardalo
   (es secreto: deja despertar teléfonos de tu proyecto, pero **nunca** el contenido de los mensajes).

### 2) Crear el Worker en Cloudflare (gratis, sin tarjeta)
1. **dash.cloudflare.com** → **Sign up** (solo email y contraseña; **no pide tarjeta**).
2. Menú **Workers & Pages** → **Create** → **Create Worker** → ponele nombre `nexo-wake` → **Deploy**.
3. **Edit code** → borrá el ejemplo y pegá TODO el contenido de **`push-sender/cloudflare/worker.js`**
   (lo tenés en el repo: github.com/maurizio-bot/nexo-app → `push-sender/cloudflare/worker.js` → botón «Raw» → copiar). → **Deploy**.

### 3) Pegar la llave como SECRETO
1. En el Worker → **Settings** → **Variables and Secrets** → **Add**.
2. Tipo **Secret** · Nombre exactamente **`SA_B64`** · Valor: **pegá todo el contenido del archivo `.json`** del paso 1.
3. **Deploy** / Save.
   - *(Si diera error al leer la llave, usá base64: en Cloud Shell `base64 -w0 archivo.json` y pegá ESE texto como `SA_B64`. El worker acepta las dos formas.)*

### 4) Probar (opcional pero recomendado, para confirmar «a la primera»)
Tomá el `Token FCM:` del diagnóstico de un teléfono (Perfil → Copiar diagnóstico) y, con NEXO **cerrada** en ese teléfono:
```bash
curl -X POST https://nexo-wake.TU-SUBDOMINIO.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"to":"<PEGA_AQUI_EL_TOKEN_FCM>"}'
```
Debe responder `{"ok":true,...}` y el teléfono despertar con el aviso «Mensaje nuevo».

### 5) Pasame la URL
La **URL del Worker** (arriba, algo como `https://nexo-wake.TU-SUBDOMINIO.workers.dev`). La dejo fija en la app.

## Alternativa por terminal (Cloud Shell, si preferís)
```bash
cd ~/nexo-app/push-sender/cloudflare
npm i -g wrangler
wrangler login            # abre un link para autorizar
wrangler deploy
# pegar la llave como secreto (en base64, a prueba de saltos de línea):
base64 -w0 /ruta/al/archivo.json | wrangler secret put SA_B64
```

## Seguridad / antiabuso
- Igual que la versión Firebase: tope de 8 toques / 5 min por token (best-effort en memoria).
- El token es la credencial; solo los contactos lo conocen (se comparte cifrado). Endurecer con una firma de
  pareja queda pendiente (igual que en la versión Firebase), para cuando la Fase 2b esté probada.
