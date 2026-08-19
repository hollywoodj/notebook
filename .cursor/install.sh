#!/usr/bin/env bash
# Idempotent bootstrap for the Notebook workspace in a Cloud Agent.
#
# Runs from the repository root after checkout. Prepares everything needed to
# build and run the API server, the CLI, the web UI, and the Tauri desktop
# crate (`cargo build --workspace`).
set -euo pipefail

cd "$(dirname "$0")/.."

# System libraries required to compile the `notebook-desktop` Tauri crate on
# Linux (GTK 3 / WebKit2GTK 4.1, libsoup 3, appindicator, librsvg). The base
# image already provides the Rust and Node toolchains. Only install when a
# representative dev package is missing so repeat runs stay fast.
if ! pkg-config --exists webkit2gtk-4.1 2>/dev/null; then
  echo "==> Installing Tauri/GTK system libraries"
  # Retry to tolerate transient Ubuntu mirror/CDN errors (e.g. sporadic HTTP 400s
  # on individual .deb downloads). Each attempt refreshes indexes and asks apt to
  # fetch anything still missing.
  apt_install_ok=0
  for attempt in 1 2 3 4 5; do
    echo "==> apt install attempt ${attempt}/5"
    sudo apt-get update -o Acquire::Retries=5 || true
    if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        --fix-missing -o Acquire::Retries=5 \
        libwebkit2gtk-4.1-dev \
        libgtk-3-dev \
        libayatana-appindicator3-dev \
        librsvg2-dev \
        libsoup-3.0-dev \
        libjavascriptcoregtk-4.1-dev \
        build-essential \
        curl \
        wget \
        file \
        libxdo-dev \
        libssl-dev \
        pkg-config; then
      apt_install_ok=1
      break
    fi
    echo "==> apt install attempt ${attempt} failed; retrying after backoff"
    sleep $((attempt * 4))
  done
  if [ "$apt_install_ok" -ne 1 ]; then
    echo "ERROR: failed to install Tauri/GTK system libraries after retries" >&2
    exit 1
  fi
else
  echo "==> Tauri/GTK system libraries already present; skipping apt install"
fi

echo "==> Installing desktop UI dependencies (npm ci)"
npm --prefix apps/desktop ci

# The Tauri desktop crate embeds the built web bundle via `frontendDist`, so the
# bundle must exist before `cargo build --workspace` can compile that crate.
echo "==> Building web frontend bundle (apps/desktop/dist)"
npm --prefix apps/desktop run build

echo "==> Building the Rust workspace (notebook-core, notebook-api, notebook-cli, notebook-desktop)"
cargo build --workspace

echo "==> Notebook workspace ready"
