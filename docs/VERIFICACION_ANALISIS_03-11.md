# Verificación del análisis competitivo externo (03-11-2026)

> Pedido del dueño: «verifica la veracidad de la información e implementa mejoras robustas para disminuir la brecha con la
> competencia». Esto es el resultado: qué del análisis es cierto, qué está exagerado/viejo, y qué se implementó.

## 1) Veracidad (verificado contra el código real)

El análisis es **mayormente honesto y correcto**. Tres puntos están **exagerados o desactualizados**:

| Punto del análisis | Veredicto | Realidad en el código |
|---|---|---|
| «No hay llamadas/videollamadas por **internet** (solo local)» | ⚠️ **FALSO (desactualizado)** | SÍ hay: `calls.js` usa `net:` (relés) como fallback aunque no estén cerca, y vídeo por **Tor directo**. Lo que falta es **confirmarlo en los teléfonos** (y corregir `COMPARATIVA.md`, que todavía dice «solo local» — es una inconsistencia interna del propio doc). |
| «Chat **lento** al crecer; vault sin paginación; lista sin virtualización» | ⚠️ **DESACTUALIZADO** | El **vault YA pagina** (build 2888: carga perezosa, cola de 80) y «lento al abrir» ya se arregló. Lo ÚNICO cierto: **no hay virtualización con reciclado de nodos** (el DOM crece al hacer scroll largo hacia atrás). |
| «Índice de robustez ~54,2» | ✅ casi (número viejo) | El real actual es **54,8** (build 2894). Si el dueño re-confirma en teléfonos, sube a ~74 (el freno es la validación real, componente B). |

Lo demás del análisis es **correcto**: multipath completo (BLE+Wi-Fi+L2CAP+Nostr+Tor+Jump 8 saltos), cifrado E2E con
poscuántico (ML-KEM-768), Fénix sin servidores, tope de audio en grupo (5), estilo ES5 + archivos grandes, iOS inexistente
(solo propuesta), FCM desplegado+probado-en-sim (falta prueba real en teléfono), buscador global inexistente, puntos de
protocolo abiertos (H3/H4/M5/M6/F6/F7/F8, SEC-2), y batería de 2.º plano sin medición real de consumo.

**El cuello de botella real NO es falta de features** — es **validar en teléfonos reales** (componente B) + batería sin
medir + cerrar los últimos huecos de protocolo. Coincide con lo honesto del análisis.

## 2) Mejoras robustas — qué se implementó y qué queda

### ✅ IMPLEMENTADO esta madrugada (método: repro en sim → batería → build)
- **Batería / A2 (build 2900): la auto-conexión respeta la pausa `no_service`.** Era la raíz de los «627 despertares» del
  diagnóstico del Vivo. El bucle de re-búsqueda ya respetaba la pausa de Bluetooth de un contacto con el GATT roto, pero la
  **auto-conexión por resultado de escaneo/reconexión NO** → al ver al peer en el escaneo lo re-conectaba igual, saltándose
  el backoff y volviendo a martillar la radio. Ahora `_autoConnectGATT` ignora a un contacto en pausa (sigue por
  internet/Wi-Fi/Jump); una conexión **manual** del usuario sí pasa. Prueba `noservice.js` test 5 (reproduce el hueco y lo
  cierra; confirma que la reconexión legítima NO se rompe). Cierra parte del hueco de batería (#13 del análisis).
- **Pacing 2b (build 2899, antes esta madrugada):** texto/ACK salta delante de los trozos de archivo en Bluetooth lento.

### ⏳ RANKeado para después (con decisión/validación del dueño)
1. **Audio: afinar gate/ducking para voz baja** (dolor real del dueño, diag. C 02-11: «micrófono casi mudo»). Alcance
   honesto: afinar el gate (`-34 dB`)/ducking, NO un AEC nuevo (el AEC real estilo WebRTC no es viable en JS puro; el
   teléfono ya hace AEC). **Riesgo:** el audio hay que oírlo en el teléfono → mejor hacerlo con el dueño probando.
2. **Virtualización de nodos en chat largo** (`render.js`): soltar nodos viejos al hacer scroll atrás. **Riesgo:**
   `render.js` es load-bearing; necesita cuidado para no regresionar. Enfoque quirúrgico (ventana acotada).
3. **Protocolo M6/M5: ignorar control `ss`/`sr`/`nm` sin autenticar** (`ble_ack.js`). Limpio y 100% sim, pero toca la
   sincronización de sesión entre contactos reales → hacerlo con una prueba `spoof` que confirme que el flujo real sigue OK.
4. **(menor) F7: acotar `FileProvider`** a `cacheDir/nexo_open` (nativo, barato).

> No metí 1-3 en modo autónomo porque son o riesgosas (audio/`render.js`) o tocan protocolo de sesión — mejor con el dueño
> presente o al menos con su visto bueno. La #2 (batería) sí era un bug claro, aislado y con prueba → se hizo.

## 3) No es código (decisión/gestión del dueño)
- **iOS** (Mac + Apple Developer + plugin Swift — ver `docs/IOS_MAC.md`), **Play Store**, **auditoría externa**.
- **FCM end-to-end:** solo falta la prueba real en los dos teléfonos (ya desplegado — `docs/PRUEBAS_FISICAS.md`).
- **Monetización** (ver `docs/DICIEMBRE.md`): el modelo lo elige el dueño; yo dejo la plomería lista.
- **Llamadas/vídeo por internet:** el código existe; falta confirmarlo en teléfonos y corregir `COMPARATIVA.md`.
