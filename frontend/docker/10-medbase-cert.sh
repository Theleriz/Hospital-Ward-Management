#!/bin/sh
# HTTPS certificate for the staff app (nginx.conf, port 443).
# Made on first start and kept in the medbase-certs volume, so a phone or tablet
# that trusted it once does not have to trust it again. Made again when
# MEDBASE_CERT_HOSTS changes. A certificate you mount yourself (medbase.crt and
# medbase.key without medbase.hosts next to them) is never touched.
# MEDBASE_CERT_HOSTS: extra names or IP addresses of this computer, comma separated,
# e.g. "192.168.1.25,medbase.local".
set -eu

DIR=/etc/nginx/certs
CRT="$DIR/medbase.crt"
KEY="$DIR/medbase.key"
STAMP="$DIR/medbase.hosts"
HOSTS="localhost,127.0.0.1${MEDBASE_CERT_HOSTS:+,$MEDBASE_CERT_HOSTS}"

mkdir -p "$DIR"

if [ -f "$CRT" ] && [ -f "$KEY" ]; then
    [ ! -f "$STAMP" ] && exit 0                      # your own certificate
    [ "$(cat "$STAMP")" = "$HOSTS" ] && exit 0      # ours, same names
fi

SAN=""
for h in $(echo "$HOSTS" | tr ',' ' '); do
    if echo "$h" | grep -Eq '^[0-9.]+$|:'; then SAN="$SAN,IP:$h"; else SAN="$SAN,DNS:$h"; fi
done
SAN="${SAN#,}"

openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
    -keyout "$KEY" -out "$CRT" \
    -subj "/CN=MedBase (internal)" \
    -addext "subjectAltName=$SAN" \
    -addext "extendedKeyUsage=serverAuth" 2>/dev/null
chmod 600 "$KEY"
echo "$HOSTS" > "$STAMP"
echo "medbase: made a self-signed HTTPS certificate for $HOSTS"
