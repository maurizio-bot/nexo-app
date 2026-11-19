#!/usr/bin/env python3
"""Estima a ojo cuánto contexto lleva la plática (dueño 18-11). Cuenta los caracteres de la conversación desde el último resumen
automático (texto, herramientas y resultados; las imágenes no cuentan) y los pasa a % con la calibración del dueño:
18-11: 408 043 caracteres (+7 imágenes) = 44 % → ~9 270 por 1 %; 10 000 se quedaba corta (42 % vs 45 % real); se usa 9 000 por 1 % (30 % = 270 000).
Uso: python3 docs/contexto_estimar.py [ruta.jsonl]   (sin ruta: la transcripción más reciente)."""
import json, sys, glob, os
POR_CIENTO = 9000  # cifra redonda; 18-11: con 10 000 marcaba 42 % cuando el dueño veía 45 %; con 9 000 marca 46 % (avisa un poco antes)
p = sys.argv[1] if len(sys.argv) > 1 else max(glob.glob('/root/.claude/projects/*/*.jsonl'), key=os.path.getmtime)
rows = []
for l in open(p):
    try: rows.append(json.loads(l))
    except Exception: pass
def texto(o):
    c = (o.get('message') or {}).get('content'); n = 0
    if isinstance(c, str): return len(c), c
    first = ''
    for x in (c or []):
        if not isinstance(x, dict): continue
        t = x.get('type')
        if t == 'text': n += len(x.get('text', '')); first = first or x.get('text', '')
        elif t == 'tool_use': n += len(json.dumps(x.get('input', {}), ensure_ascii=False))
        elif t == 'tool_result':
            cc = x.get('content')
            if isinstance(cc, str): n += len(cc)
            elif isinstance(cc, list): n += sum(len(y.get('text', '')) for y in cc if isinstance(y, dict) and y.get('type') == 'text')
    return n, first
b = 0
for i, o in enumerate(rows):
    if o.get('type') == 'user' and 'This session is being continued' in json.dumps(o.get('message'), ensure_ascii=False)[:6000]: b = i
total = sum(texto(o)[0] for o in rows[b:])
print('caracteres desde el último resumen: %d  ≈ %.0f %% de la ventana (30 %% = %d)' % (total, total / POR_CIENTO, 30 * POR_CIENTO))
