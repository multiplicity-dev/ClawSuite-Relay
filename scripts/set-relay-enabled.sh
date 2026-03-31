#!/usr/bin/env bash
set -euo pipefail

STATE="${1:-}"
RESTART="${2:-}"
DROPIN_FILE="${DROPIN_FILE:-$HOME/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf}"
KEY="CLAWSUITE_RELAY_ENABLED"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") <0|1|off|on> [--restart]

Examples:
  $(basename "$0") 0
  $(basename "$0") off --restart
  $(basename "$0") on --restart
USAGE
}

if [[ -z "$STATE" ]]; then
  usage
  exit 1
fi

case "$STATE" in
  1|on|ON|true|TRUE) VALUE="1" ;;
  0|off|OFF|false|FALSE) VALUE="0" ;;
  *)
    echo "Invalid state: $STATE"
    usage
    exit 1
    ;;
esac

mkdir -p "$(dirname "$DROPIN_FILE")"
if [[ ! -f "$DROPIN_FILE" ]]; then
  printf '[Service]\n' > "$DROPIN_FILE"
fi

python3 - "$DROPIN_FILE" "$KEY" "$VALUE" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

lines = path.read_text(encoding='utf-8').splitlines()
out = []
found = False

for line in lines:
    if line.startswith(f"Environment={key}="):
        out.append(f"Environment={key}={value}")
        found = True
    else:
        out.append(line)

if not found:
    has_service = any(l.strip() == "[Service]" for l in out)
    if not has_service:
        out.insert(0, "[Service]")
    out.append(f"Environment={key}={value}")

path.write_text("\n".join(out) + "\n", encoding='utf-8')
print(f"Updated {path}: {key}={value}")
PY

if [[ "$RESTART" == "--restart" ]]; then
  systemctl --user daemon-reload
  systemctl --user restart openclaw-gateway.service
  echo "Gateway restarted."
else
  echo "No restart performed."
  echo "Run: systemctl --user daemon-reload && systemctl --user restart openclaw-gateway.service"
fi
