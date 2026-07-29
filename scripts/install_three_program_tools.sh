#!/usr/bin/env bash
set -euo pipefail

# Installs only the official/local tooling needed by the bounded three-program
# workflow. It deliberately does not install nuclei, sqlmap, ffuf, scanners,
# brute-force tools, or exploit frameworks.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="${MULTI_AGENT_TOOLS_DIR:-$ROOT_DIR/.tools}"
MATTERMOST_DOCKER_COMMIT="497414659ee7127677d2b91b44bb4f3ea9d14695"

cd "$ROOT_DIR"

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
fi
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

"$ROOT_DIR/scripts/install_portswigger_mcp.sh" || {
  echo >&2
  echo "The PortSwigger release download failed." >&2
  echo "Install 'MCP Server' from Burp's BApp Store, then continue." >&2
}

mkdir -p "$TOOLS_DIR"
if [[ ! -d "$TOOLS_DIR/mattermost-docker/.git" ]]; then
  git clone https://github.com/mattermost/docker.git "$TOOLS_DIR/mattermost-docker"
fi
git -C "$TOOLS_DIR/mattermost-docker" fetch --depth 1 origin "$MATTERMOST_DOCKER_COMMIT"
git -C "$TOOLS_DIR/mattermost-docker" checkout --detach "$MATTERMOST_DOCKER_COMMIT"
actual="$(git -C "$TOOLS_DIR/mattermost-docker" rev-parse HEAD)"
if [[ "$actual" != "$MATTERMOST_DOCKER_COMMIT" ]]; then
  echo "Mattermost Docker source verification failed." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Docker is not installed. Install Docker Engine using the official guide:
https://docs.docker.com/engine/install/

Do not pipe an unreviewed installer into a privileged shell. After Docker is
installed, follow Mattermost's official container deployment guide:
https://docs.mattermost.com/deployment-guide/server/deploy-containers.html
EOF
fi

for source in mattermost files amazon; do
  if [[ ! -f "$ROOT_DIR/plans/$source.json" ]]; then
    cp "$ROOT_DIR/plans/$source.example.json" "$ROOT_DIR/plans/$source.json"
  fi
done
if [[ ! -f "$ROOT_DIR/multi_program_config.yaml" ]]; then
  cp "$ROOT_DIR/multi_program_config.example.yaml" "$ROOT_DIR/multi_program_config.yaml"
fi

cat <<EOF
Installed project dependencies and pinned Mattermost Docker deployment source.

Next steps:
  1. Fill placeholders in multi_program_config.yaml.
  2. Deploy your own Mattermost instance from:
     $TOOLS_DIR/mattermost-docker
  3. Load/enable the official PortSwigger MCP Server in Burp.
  4. Review plans/*.json.
  5. Validate only:
     .venv/bin/python multi_program_agent.py validate
  6. Dry run all three workers concurrently:
     .venv/bin/python multi_program_agent.py run --dry-run

Live mode requires an additional --approve flag and still remains bounded by
exact-host, known-URL, method, request-budget, and rate policies.
EOF
