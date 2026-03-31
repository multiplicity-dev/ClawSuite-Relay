#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-}"
RESTART="${2:-}"
DROPIN_FILE="${DROPIN_FILE:-$HOME/.config/systemd/user/openclaw-gateway.service.d/clawsuite-relay.conf}"
KEY="CLAWSUITE_RELAY_FORWARD_MODE"

usage() {
  cat <<USAGE
Usage:
  $(basename "$0") <assistant_last|turn_rich> [--restart]

Examples:
  $(basename "$0") turn_rich
  $(basename "$0") assistant_last --restart

Notes:
  - Edits: $DROPIN_FILE
  - If --restart is provided, runs:
      systemctl --user daemon-reload
      systemctl --user restart openclaw-gateway.service
USAGE
}

if [[ -z "$MODE" ]]; then
  usage
  exit 1
fi

if [[ "$MODE" != "assistant_last" && "$MODE" != "turn_rich" ]]; then
  echo "Error: invalid mode '$MODE'"
  usage
  exit 1
fi

mkdir -p "$(dirname "$DROPIN_FILE")"
if [[ ! -f "$DROPIN_FILE" ]]; then
  printf '[Service]\n' > "$DROPIN_FILE"
fi

python3 - "$DROPIN_FILE" "$KEY" "$MODE" <<'PY'
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
    # Ensure [Service] section exists; if not, prepend it.
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
  echo "Run these when ready:"
  echo "  systemctl --user daemon-reload"
  echo "  systemctl --user restart openclaw-gateway.service"
fi
