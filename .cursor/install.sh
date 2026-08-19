#!/usr/bin/env bash
# Idempotent dependency refresh for the Notebook workspace.
# System libraries (GTK/WebKit for the Tauri desktop crate) are baked into the
# base snapshot, so this script only prepares source-derived state.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Installing desktop UI dependencies (npm ci)"
npm --prefix apps/desktop ci

# The Tauri desktop crate embeds the built frontend via `frontendDist`, so the
# web bundle must exist before `cargo build --workspace` can compile it.
echo "==> Building web frontend bundle (apps/desktop/dist)"
npm --prefix apps/desktop run build

echo "==> Building the Rust workspace (notebook-core, notebook-api, notebook-cli, notebook-desktop)"
cargo build --workspace

echo "==> Notebook workspace ready"
