#!/bin/bash
# Compile le binaire CLI `terminials` en release et le symlinke dans ~/.local/bin.
set -e
cd "$(dirname "$0")/.."
cargo build -p terminials-cli --release
mkdir -p "$HOME/.local/bin"
ln -sf "$(pwd)/target/release/terminials" "$HOME/.local/bin/terminials"
echo "terminials installé dans ~/.local/bin (vérifie qu'il est dans ton PATH)."
