#!/usr/bin/env bash
# openspec-forge bootstrap — downloads the kit and runs the shared install.mjs.
# Usage:  curl -fsSL https://raw.githubusercontent.com/c0d3beat/openspec-forge/main/install.sh | bash
#         (pin a version:  FORGE_REF=v1.0.0 ... )   (pass flags:  ... | bash -s -- --update )
set -euo pipefail

REPO="c0d3beat/openspec-forge"
REF="${FORGE_REF:-main}"
TARGET="$(pwd)"

command -v node >/dev/null 2>&1 || { echo "✗ Node.js is required. Install Node ≥18 and run 'openspec init' here first."; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "openspec-forge: downloading ${REPO}@${REF}…"
if ! curl -fsSL "https://github.com/${REPO}/archive/refs/tags/${REF}.tar.gz" -o "$TMP/kit.tgz" 2>/dev/null; then
  curl -fsSL "https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz" -o "$TMP/kit.tgz"
fi
tar -xzf "$TMP/kit.tgz" -C "$TMP"
SRC="$(find "$TMP" -maxdepth 1 -type d -name 'openspec-forge-*' | head -n1)"

exec node "$SRC/install.mjs" --dir "$TARGET" "$@"
