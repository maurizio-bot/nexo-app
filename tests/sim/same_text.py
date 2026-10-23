# Reestructuración: comprueba que lo quitado del origen es EXACTAMENTE lo que está en los módulos nuevos (salvo
# "export " y la cabecera del módulo) y que en el origen solo se añadieron líneas import.
# Uso: python3 same_text.py <origen_antes> <origen_ahora> <modulo_nuevo> [<modulo_nuevo2> ...]
import difflib, re, sys
before, after, mods = sys.argv[1], sys.argv[2], sys.argv[3:]
a = open(before).read().split('\n'); b = open(after).read().split('\n')
d = list(difflib.unified_diff(a, b, lineterm='', n=0))
removed = [l[1:] for l in d if l.startswith('-') and not l.startswith('---')]
added = [l[1:] for l in d if l.startswith('+') and not l.startswith('+++')]
bad_added = [l for l in added if l.strip() and not l.startswith('import ')]
body = []
for m in mods:
    t = open(m).read().split('\n')
    i = next((k for k, l in enumerate(t) if l.strip() == '*/'), -1)   # tras la cabecera
    body += [re.sub(r'^export ', '', l) for l in t[i + 1:]]
key = lambda xs: sorted(l for l in xs if l.strip() and not l.startswith('import '))
ok = key(removed) == key(body) and not bad_added
print(('IDÉNTICO' if ok else 'DIFERENTE') + f': {len([l for l in removed if l.strip()])} líneas movidas, {len(added)} añadidas en el origen')
if not ok:
    for l in bad_added[:5]: print('  añadida (no import):', l[:100])
    sr, sb = key(removed), key(body)
    for l in [x for x in sr if x not in sb][:5]: print('  solo quitada:', l[:100])
    for l in [x for x in sb if x not in sr][:5]: print('  solo en módulo:', l[:100])
sys.exit(0 if ok else 1)
