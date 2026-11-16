#!/usr/bin/env python3
# Genera el texto de instalación (cloud-init) del relé propio de NEXO para pegarlo en «Cloud config» al crear el servidor
# (Ubuntu 24.04). Uso: python3 infra/servidor/generar.py relay.midominio.com > cloud-init.yaml
# Instala: strfry (compilado desde su repositorio, como su docs/DEPLOYMENT.md), la política de escritura de NEXO
# (nexo-policy.py), Caddy (certificado TLS automático, wss://) y el cortafuegos. Sin contraseñas ni claves dentro.
import os, re, sys

host = (sys.argv[1] if len(sys.argv) > 1 else '').strip().lower()
if not re.match(r'^[a-z0-9-]+(\.[a-z0-9-]+)+$', host):
    sys.exit('uso: generar.py relay.midominio.com')
here = os.path.dirname(os.path.abspath(__file__))
policy = open(os.path.join(here, 'nexo-policy.py'), encoding='utf8').read()
RAW = 'https://raw.githubusercontent.com/maurizio-bot/nexo-app/NEXOCHAT/infra/servidor/nexo-policy.py'

def block(text, n=6):
    pad = ' ' * n
    return '\n'.join(pad + l if l else '' for l in text.rstrip('\n').split('\n'))

unit = """[Unit]
Description=Relé propio de NEXO (strfry)
After=network-online.target
[Service]
User=strfry
ExecStart=/usr/local/bin/strfry --config=/etc/strfry.conf relay
Restart=on-failure
RestartSec=5
LimitNOFILE=524288
ProtectHome=yes
NoNewPrivileges=yes
ProtectSystem=full
[Install]
WantedBy=multi-user.target
"""
caddy = host + """ {
    reverse_proxy 127.0.0.1:7777
}
"""
upd = """#!/bin/sh
# Trae la política de escritura de NEXO del repositorio (rama NEXOCHAT); solo la cambia si es Python válido y distinta.
set -e
curl -fsSL --max-time 60 '""" + RAW + """' -o /opt/nexo/nexo-policy.new
python3 -m py_compile /opt/nexo/nexo-policy.new
if ! cmp -s /opt/nexo/nexo-policy.new /opt/nexo/nexo-policy.py; then
  install -m 0755 /opt/nexo/nexo-policy.new /opt/nexo/nexo-policy.py
fi
rm -f /opt/nexo/nexo-policy.new
"""
svc = """[Unit]
Description=Actualiza la política de escritura de NEXO
[Service]
Type=oneshot
ExecStart=/opt/nexo/actualizar.sh
"""
tmr = """[Unit]
Description=Actualiza la política de escritura de NEXO cada 6 h
[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
[Install]
WantedBy=timers.target
"""
out = """#cloud-config
# Relé propio de NEXO para """ + host + """ (generado por infra/servidor/generar.py). Tarda unos 10-15 minutos en quedar listo.
package_update: true
package_upgrade: true
packages:
  - git
  - build-essential
  - libyaml-perl
  - libtemplate-perl
  - libregexp-grammars-perl
  - libssl-dev
  - zlib1g-dev
  - liblmdb-dev
  - libflatbuffers-dev
  - libsecp256k1-dev
  - libzstd-dev
  - ufw
  - python3
  - curl
  - gnupg
  - debian-keyring
  - debian-archive-keyring
  - apt-transport-https
swap:
  filename: /swapfile
  size: 2G
write_files:
  - path: /opt/nexo/nexo-policy.py
    permissions: '0755'
    content: |
""" + block(policy) + """
  - path: /etc/systemd/system/strfry.service
    content: |
""" + block(unit) + """
  - path: /opt/nexo/Caddyfile
    content: |
""" + block(caddy) + """
  - path: /opt/nexo/actualizar.sh
    permissions: '0755'
    content: |
""" + block(upd) + """
  - path: /etc/systemd/system/nexo-politica.service
    content: |
""" + block(svc) + """
  - path: /etc/systemd/system/nexo-politica.timer
    content: |
""" + block(tmr) + """
runcmd:
  - [sh, -c, 'cd /opt && git clone https://github.com/hoytech/strfry.git && cd strfry && git submodule update --init && make setup-golpe && make -j2 && install -m 0755 strfry /usr/local/bin/strfry']
  - [sh, -c, 'id strfry || useradd -M -s /usr/sbin/nologin strfry']
  - [sh, -c, 'mkdir -p /var/lib/strfry && chown strfry:strfry /var/lib/strfry && chmod 755 /var/lib/strfry']
  - [sh, -c, 'cp /opt/strfry/strfry.conf /etc/strfry.conf && sed -i -e "s#db = \\"./strfry-db/\\"#db = \\"/var/lib/strfry/\\"#" -e "s#realIpHeader = \\"\\"#realIpHeader = \\"x-forwarded-for\\"#" -e "s#plugin = \\"\\"#plugin = \\"/opt/nexo/nexo-policy.py\\"#" /etc/strfry.conf && chown strfry:strfry /etc/strfry.conf']
  - [sh, -c, 'systemctl daemon-reload && systemctl enable --now strfry']
  - [sh, -c, 'apt-get install -y caddy || (curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list && apt-get update && apt-get install -y caddy)']
  - [sh, -c, 'cp /opt/nexo/Caddyfile /etc/caddy/Caddyfile && systemctl enable caddy && systemctl restart caddy']
  - [sh, -c, 'ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable']
  - [sh, -c, 'systemctl enable --now nexo-politica.timer']
"""
sys.stdout.write(out)
