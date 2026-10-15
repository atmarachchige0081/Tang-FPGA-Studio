#!/usr/bin/env bash
set -euo pipefail
if (( $# < 2 )); then
  echo 'Usage: run-ci-check.sh LOGFILE COMMAND [ARGUMENTS...]' >&2
  exit 2
fi
gate_log=$1
shift
mkdir -p "$(dirname -- "$gate_log")"
set +e
"$@" 2>&1 | tee "$gate_log"
gate_pipeline=("${PIPESTATUS[@]}")
set -e
gate_status=${gate_pipeline[0]}
if (( gate_status == 0 && gate_pipeline[1] != 0 )); then gate_status=${gate_pipeline[1]}; fi
if (( gate_status != 0 )) && [[ ${GITHUB_ACTIONS:-} == true ]]; then
  python3 - "$gate_log" <<'PY' || true
from pathlib import Path
import sys
tail = Path(sys.argv[1]).read_text(errors='replace')[-1800:]
tail = tail.replace('%', '%25').replace('\r', '%0D').replace('\n', '%0A')
print('::error title=Release check failed::' + tail)
PY
fi
exit "$gate_status"
