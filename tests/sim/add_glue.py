# Reestructuración: añade a un módulo recién creado sus import y el pegamento (lo que recibe de main.js al arrancar)
# y la llamada en main.js. Uso: python3 add_glue.py <modulo.js> <nombreUse|-> "<import1>" ... -- glue1 glue2 ...
import re, sys
mod, use = sys.argv[1], sys.argv[2]
rest = sys.argv[3:]
imports = rest[:rest.index('--')] if '--' in rest else rest
glue = rest[rest.index('--') + 1:] if '--' in rest else []
s = open(mod).read()
i = s.index(' */\n') + 4
add = ''.join(l + '\n' for l in imports)
if glue:
    add += ('\n// [pegamento] Lo que usa del resto de la app (main.js lo da al arrancar)\nvar ' + ', '.join(glue) + ';\n' +
            'export function ' + use + '(d) { ' + ' '.join(f'{g} = d.{g};' for g in glue) + ' } // [/pegamento]\n')
s = s[:i] + add + '\n' + s[i:]
open(mod, 'w').write(s)
if glue:
    m = 'src/main.js'; t = open(m).read()
    rel = './' + mod.split('src/', 1)[1]
    pat = re.compile(r"^import \{ (.*) \} from '" + re.escape(rel) + r"';\n", re.M)
    mm = pat.search(t)
    assert mm, 'no encuentro el import de ' + rel
    line = "import { " + use + ", " + mm.group(1) + " } from '" + rel + "';\n" + use + "({ /* [pegamento] */ " + ', '.join(f'{g}: {g}' for g in glue) + " });\n"
    t = t[:mm.start()] + line + t[mm.end():]
    open(m, 'w').write(t)
print('ok', mod)
