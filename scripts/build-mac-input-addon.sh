#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT_DIR/native-mac-input-addon/build/Release"
NODE_INCLUDE_DIR="${NODE_INCLUDE_DIR:-/usr/local/include/node}"

if [[ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]]; then
  NODE_INCLUDE_DIR="/usr/local/Cellar/node@22/22.22.1_1/include/node"
fi

if [[ ! -f "$NODE_INCLUDE_DIR/node_api.h" ]]; then
  echo "Could not find node_api.h. Set NODE_INCLUDE_DIR=/path/to/node/include." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

clang++ \
  -std=c++17 \
  -arch x86_64 \
  -DNAPI_VERSION=10 \
  -DNODE_GYP_MODULE_NAME=mac_input \
  -I"$NODE_INCLUDE_DIR" \
  -fvisibility=hidden \
  -bundle \
  -undefined dynamic_lookup \
  -framework ApplicationServices \
  "$ROOT_DIR/native-mac-input-addon/src/mac_input_addon.cc" \
  -o "$OUT_DIR/mac-input.node"
