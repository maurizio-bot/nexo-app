#!/usr/bin/env python3
# 3319 (Google Play, targetSdk 35+): Play exige que las librerías nativas (.so) del APK/AAB funcionen con páginas de memoria de 16 KB
# (teléfonos nuevos con Android 15+). Comprueba cada .so: sus segmentos LOAD alineados a 16 KB o más y, si va sin comprimir dentro del
# APK, su posición en el ZIP también. Solo avisa (::warning:: en el CI): para la tienda hará falta arreglarlo, el APK de prueba sirve igual.
# Uso: python3 tools/pagina16k.py app.apk   → sale 0 siempre; imprime «16KB OK» o la lista de las que no.
import struct, sys, zipfile

PAGE = 16384

def load_aligns(data):
    if data[:4] != b'\x7fELF': return None
    cls, endian = data[4], data[5]
    e = '<' if endian == 1 else '>'
    if cls == 2:
        phoff = struct.unpack_from(e + 'Q', data, 0x20)[0]; phentsize, phnum = struct.unpack_from(e + 'HH', data, 0x36)
        out = []
        for i in range(phnum):
            o = phoff + i * phentsize
            if struct.unpack_from(e + 'I', data, o)[0] == 1: out.append(struct.unpack_from(e + 'Q', data, o + 0x30)[0])
        return out
    phoff = struct.unpack_from(e + 'I', data, 0x1c)[0]; phentsize, phnum = struct.unpack_from(e + 'HH', data, 0x2a)
    out = []
    for i in range(phnum):
        o = phoff + i * phentsize
        if struct.unpack_from(e + 'I', data, o)[0] == 1: out.append(struct.unpack_from(e + 'I', data, o + 0x1c)[0])
    return out

def check(path):
    bad, n = [], 0
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            if not (info.filename.startswith('lib/') and info.filename.endswith('.so')): continue
            n += 1
            abi = info.filename.split('/')[1] if info.filename.count('/') >= 2 else ''
            aligns = load_aligns(z.read(info.filename))
            if aligns is None: bad.append(info.filename + ': no es ELF'); continue
            if abi in ('arm64-v8a', 'x86_64') and any(a < PAGE for a in aligns):
                bad.append(info.filename + ': segmentos alineados a ' + str(min(aligns)) + ' (hace falta 16384)')
            if info.compress_type == zipfile.ZIP_STORED and abi in ('arm64-v8a', 'x86_64'):
                with open(path, 'rb') as f:
                    f.seek(info.header_offset); h = f.read(30)
                    start = info.header_offset + 30 + struct.unpack_from('<H', h, 26)[0] + struct.unpack_from('<H', h, 28)[0]
                if start % PAGE: bad.append(info.filename + ': sin comprimir y no alineado a 16 KB dentro del APK')
    return n, bad

if __name__ == '__main__':
    n, bad = check(sys.argv[1])
    if bad:
        for b in bad: print('::warning::Páginas de 16 KB (Google Play): ' + b)
        print('16KB FALTA en %d de %d librerías' % (len(bad), n))
    else: print('16KB OK (%d librerías nativas)' % n)
