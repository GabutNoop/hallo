#!/usr/bin/env bash
set -euo pipefail

# Installs the pinned official PortSwigger MCP Server release JAR.
# Source: https://github.com/PortSwigger/mcp-server

VERSION="${PORTSWIGGER_MCP_VERSION:-1.3.0}"
EXPECTED_VERSION="1.3.0"
EXPECTED_SHA256="c4011245ee7da0cb901b9c0435aba3d8458ab5b0e2078e1a87fd025ed93c7892"
REPOSITORY="PortSwigger/mcp-server"
ASSET="burp-mcp-all.jar"
INSTALL_ROOT="${PORTSWIGGER_MCP_INSTALL_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/tab-copilot/portswigger-mcp}"
INSTALL_DIR="$INSTALL_ROOT/v$VERSION"
DESTINATION="$INSTALL_DIR/$ASSET"
URL="https://github.com/$REPOSITORY/releases/download/v$VERSION/$ASSET"

if [[ "$VERSION" != "$EXPECTED_VERSION" ]]; then
  echo "Refusing unpinned version $VERSION. Review and update the expected digest first." >&2
  exit 2
fi

mkdir -p "$INSTALL_DIR"
temporary="$(mktemp "$INSTALL_DIR/.${ASSET}.XXXXXX")"
trap 'rm -f "$temporary"' EXIT

echo "Downloading official $REPOSITORY v$VERSION..."
if command -v gh >/dev/null 2>&1; then
  temp_dir="$(mktemp -d "$INSTALL_DIR/.gh-download.XXXXXX")"
  trap 'rm -f "$temporary"; rm -rf "$temp_dir"' EXIT
  if ! gh release download "v$VERSION" \
      --repo "$REPOSITORY" \
      --pattern "$ASSET" \
      --dir "$temp_dir" \
      --clobber; then
    echo "GitHub release download failed. Check access to release-assets.githubusercontent.com." >&2
    exit 1
  fi
  mv "$temp_dir/$ASSET" "$temporary"
  rm -rf "$temp_dir"
elif command -v curl >/dev/null 2>&1; then
  curl --fail --location --retry 3 --retry-all-errors \
    --connect-timeout 20 --output "$temporary" "$URL"
else
  echo "Install either GitHub CLI (gh) or curl, then retry." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  actual="$(sha256sum "$temporary" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  actual="$(shasum -a 256 "$temporary" | awk '{print $1}')"
else
  echo "A SHA-256 utility (sha256sum or shasum) is required." >&2
  exit 1
fi

if [[ "$actual" != "$EXPECTED_SHA256" ]]; then
  echo "SHA-256 mismatch; refusing to install." >&2
  echo "Expected: $EXPECTED_SHA256" >&2
  echo "Actual:   $actual" >&2
  exit 1
fi

chmod 0644 "$temporary"
mv "$temporary" "$DESTINATION"
ln -sfn "v$VERSION" "$INSTALL_ROOT/current"
trap - EXIT

cat <<EOF
Installed and verified:
  $DESTINATION
  SHA-256: $EXPECTED_SHA256

Load it in Burp Suite:
  Extensions -> Installed -> Add -> Extension type: Java -> select the JAR

Then in Burp's MCP tab:
  1. Bind to 127.0.0.1 (never 0.0.0.0).
  2. Keep HTTP request approval enabled.
  3. Keep data-access approval enabled.
  4. Keep config-editing tools disabled.
  5. Do not configure wildcard auto-approved targets.

The TAB Copilot uses only three read-only MCP tools and blocks request-sending,
Intruder, Collaborator, config-editing, and editor-writing tools.
EOF
