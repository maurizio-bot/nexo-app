# Plan «acortar la distancia» (dueño 27-11, tras `docs/COMPARATIVA_APPS.md`)

Todo lo de abajo está APROBADO por el dueño («donde tú me propones la solución, se hace esa»). Orden de trabajo:

## 0. Sincronía de chats (dueño 27-11) — base de 1 y del «deslizar abajo»
PORQUÉ: que nada se pierda y que los dos (o todos en un grupo) tengan la misma conversación; lo perdido se recupera.
- **Hoy** (`ble_ack_incoming.js` 'ss'/'sr'): solo 1 a 1, solo compara el último número de secuencia, solo reenvía MIS textos sin
  confirmar de los últimos 7 días (máx. 50). No archivos, no grupos, no lo que el otro sí recibió y yo perdí.
- **Lo que pide el dueño:** al ENTRAR a un chat (y al deslizar hacia abajo en él) se comparan los dos lados y se completa lo que falta.
  1 a 1 y grupos. Lo que falta se coloca EN SU LUGAR (por la hora de quien lo escribió, no la de llegada; hoy la cola ya se ordena
  por timestamp → comprobar que el timestamp guardado es el del autor y qué pasa con relojes desfasados). Archivos también, salvo
  los que el dueño del teléfono BORRÓ (borrado = marca que viaja y no se vuelve a pedir; si no, el otro lo vuelve a «sincronizar»).
- **Diseño propuesto (barato en datos):** resumen por tramos: cada lado manda, por día (o bloque de 100), cuántos mensajes y una huella
  de sus ids; solo en los tramos que difieren se intercambia la lista de ids y se piden los que faltan (texto primero; archivos por
  el camino que haya, grandes por Wi-Fi/directo). Grupos: el mismo resumen con cada miembro que esté a mano (cualquiera que lo tenga
  sirve, va firmado por su autor). Límite de horizonte: lo guardado (ver 1), no 7 días.
- **Deslizar hacia abajo en el chat:** se QUITA «cerrar el chat» (`chat_nav._setupPullToClose`, ronda 2783) y pasa a ser «actualizar»
  = esta sincronía, como en la lista de contactos (dueño 27-11).

## 1. Mensajes sin tope de 2000 + búsqueda en todo el chat
- Hoy: un archivo cifrado por chat que se reescribe ENTERO en cada mensaje (`vault_messages._saveMessagesNow`, `slice(-2000)`: lo
  viejo se borra sin avisar). Arreglo: el archivo vivo chico + «histórico» en bloques que no se reescriben; tope por TAMAÑO
  (1 GB mínimo, ajustable en Ajustes), nada se borra mientras haya espacio.
- Búsqueda (`search_ui.js`): hoy solo en las burbujas pintadas → buscar en todo (vivo + histórico) y llevar al mensaje.

## 2. Archivos grandes por internet sin relés
- Hoy ~40 MB por relés públicos (miles de trozos, los relés limitan: 3160). Arreglo: conexión DIRECTA entre los dos teléfonos (la
  misma WebRTC de la llamada 1 a 1, `call_p2p.js`) para archivos de hasta 1–2 GB cuando los dos están en línea; si el otro no,
  buzón (5 MB) o «cita».

## 3. Llamadas de grupo por internet y Wi-Fi
- Hoy 5, malla, solo enlace directo (`group_call.js` GMAX_AUDIO). Meta: **vídeo hasta 9** (cuadrícula de 6 + mi miniatura, vídeo
  chico por cuadro), **voz hasta 30**, por internet (WebRTC) además de Wi-Fi/Bluetooth. Medir calor/batería en teléfonos reales.

## 4. Wi-Fi Direct listo antes de tiempo (opción B del dueño)
- Hoy el grupo se arma en CADA envío. B: montarlo al haber intención (abrir el chat de ese contacto, adjuntar, cámara, o algo
  pesado en cola) y dejarlo vivo unos minutos. Los dos teléfonos con el mismo protocolo. (A = con cada Bluetooth: descartada por
  batería, un solo grupo en Android, Wi-Fi normal que se cae en algunos teléfonos y multitudes.)

## 5. Grupos de hasta 100 (hoy 32, `GS_MAX_MEMBERS`): junto con el buzón (un archivo se sube una vez) y cuidando los límites de relés.

## 6. Baratos (entre medio)
- Quitar los ~20 botones de atrás/X que quedan (lista en la comparativa / inventario: Nuevo grupo, Reenviar, Compartir contactos,
  Enviar a, Destacados, revisión de galería, cobro, pasar cuenta, editor de stickers, cámara, buscar en chat, selección, guía, juegos).
- Lista de quién ve mis estados. Mensajes que desaparecen (24 h / 7 d / 90 d). Notas de vídeo (botón junto al de foto en la cámara).
  Encuestas. Ubicación en vivo (permiso de ubicación; «todo el tiempo» para pantalla apagada).
- Por comprobar: «stickers/emoji con audio» de WhatsApp (no confirmado).

## 7. Traducción dentro del teléfono, sin internet (ML Kit).

Fuera por ahora (dueño): QR para invitar (basta invitación + aceptar), canales y comunidades. Auditoría: después de lo de Bluetooth.
