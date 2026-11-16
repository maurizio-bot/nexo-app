#!/usr/bin/env python3
# Política de escritura del relé propio de NEXO para strfry (relay.writePolicy.plugin). Ver docs/SERVIDOR_PROPIO.md §2 y §5.
# Acepta SOLO la forma de los eventos de NEXO (kinds 1059, 1064, 1065, 5) con caducidad razonable, y limita el ritmo por IP
# (cada evento lleva una clave al azar: por pubkey no sirve). Protocolo de strfry: una línea JSON por evento en la entrada,
# una respuesta JSON por línea en la salida ({id, action: accept|reject, msg}). strfry recarga este archivo si cambia.
import json, re, sys, time

DAY = 86400
MAX_TTL = {1059: 7 * DAY, 1064: 7 * DAY, 1065: 7 * DAY}
HEX = re.compile(r'^[0-9a-f]{64}$')
DIAG = re.compile(r'^nexo-diag-[0-9a-f]{16}$')
PER_SEC, BURST = 100.0, 400.0   # por IP; holgado porque en datos móviles muchos usuarios comparten IP
buckets = {}

def allow(ip):
    now = time.monotonic()
    t, at = buckets.get(ip, (BURST, now))
    t = min(BURST, t + (now - at) * PER_SEC)
    if t < 1:
        buckets[ip] = (t, now)
        return False
    buckets[ip] = (t - 1, now)
    if len(buckets) > 50000:
        buckets.clear()
    return True

def why(ev, now):
    tags = ev.get('tags') or []
    if not isinstance(tags, list) or not all(isinstance(t, list) and t and all(isinstance(x, str) for x in t) for t in tags):
        return 'invalid: etiquetas'
    content, kind = ev.get('content'), ev.get('kind')
    exp = next((t for t in tags if t[0] == 'expiration' and len(t) > 1), None)
    if not isinstance(content, str) or len(content) > 60000:
        return 'invalid: tamaño'
    if kind == 1059:
        if len(tags) != 2 or not any(t[0] == 'p' and len(t) > 1 and HEX.match(t[1]) for t in tags) or not exp:
            return 'invalid: forma'
    elif kind == 1064:
        if len(tags) != 1 or not exp:
            return 'invalid: forma'
    elif kind == 1065:
        if len(tags) != 2 or not any(t[0] == 't' and len(t) > 1 and DIAG.match(t[1]) for t in tags) or not exp:
            return 'invalid: forma'
    elif kind == 5:
        if not tags or len(tags) > 200 or not all(t[0] == 'e' and len(t) > 1 and HEX.match(t[1]) for t in tags) or content:
            return 'invalid: forma'
    else:
        return 'blocked: no es un evento de NEXO'
    if exp:
        try:
            t = int(exp[1])
        except ValueError:
            return 'invalid: caducidad'
        if not (t > now) or t > now + MAX_TTL[kind] + 3600:
            return 'invalid: caducidad'
    return None

for line in sys.stdin:
    try:
        req = json.loads(line)
    except ValueError:
        continue
    ev = req.get('event') or {}
    msg = why(ev, int(time.time()))
    if not msg and req.get('sourceType') not in ('Import', 'Stream', 'Sync', 'Stored') and not allow(str(req.get('sourceInfo') or '')):
        msg = 'rate-limited: despacio'
    sys.stdout.write(json.dumps({'id': ev.get('id', ''), 'action': 'reject' if msg else 'accept', 'msg': msg or ''}) + '\n')
    sys.stdout.flush()
