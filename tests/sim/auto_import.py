# Reestructuración: para un módulo nuevo, añade los import de los nombres que le faltan buscando quién los exporta en
# src/ (export function/var/const/class o export { … }). Si un nombre lo exportan varios, se para y lo dice.
# Uso: python3 auto_import.py <modulo.js> [preferido.js ...]
import os, re, subprocess, sys
mod = sys.argv[1]
prefer = [os.path.abspath(x) for x in sys.argv[2:]]   # si varios lo exportan, el de estos archivos
root = os.path.join(os.path.dirname(__file__), '../../src')
out = subprocess.run(['node', os.path.join(os.path.dirname(__file__), 'undef.js'), mod], capture_output=True, text=True).stdout
names = [l.split()[0] for l in out.splitlines() if l and not l.startswith(('Sin ', '0 ')) and 'sin definir' not in l]
if not names: print('nada que importar'); sys.exit(0)
exports = {}
for d, _, fs in os.walk(root):
    for f in fs:
        if not f.endswith('.js'): continue
        p = os.path.join(d, f)
        if os.path.abspath(p) == os.path.abspath(mod): continue
        t = open(p).read()
        for n in re.findall(r'^export (?:async )?(?:function|var|const|let|class) ([\w$]+)', t, re.M): exports.setdefault(n, []).append(p)
        for grp in re.findall(r'^export \{([^}]*)\}', t, re.M):
            for n in [x.strip().split(' as ')[-1] for x in grp.split(',') if x.strip()]: exports.setdefault(n, []).append(p)
        for m in re.finditer(r'^export var ([\w$]+(?:\s*=[^,;]*)?(?:,\s*[\w$]+(?:\s*=[^,;]*)?)*)', t, re.M):
            for n in re.findall(r'(?:^|,\s*)([\w$]+)', m.group(1)): exports.setdefault(n, []).append(p)
by = {}
for n in names:
    srcs = sorted(set(exports.get(n, [])))
    if len(srcs) > 1 and any(os.path.abspath(x) in prefer for x in srcs): srcs = [x for x in srcs if os.path.abspath(x) in prefer][:1]
    if len(srcs) != 1: print(f'{n}: ' + ('nadie lo exporta' if not srcs else 'varios: ' + ', '.join(srcs))); sys.exit(1)
    rel = os.path.relpath(srcs[0], os.path.dirname(mod)).replace(os.sep, '/')
    by.setdefault(rel if rel.startswith('.') else './' + rel, []).append(n)
s = open(mod).read()
i = s.index(' */\n') + 4
lines = ''.join(f"import {{ {', '.join(sorted(v))} }} from '{k}';\n" for k, v in sorted(by.items()))
open(mod, 'w').write(s[:i] + lines + '\n' + s[i:])
print(lines, end='')
