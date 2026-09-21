// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Garde-fou : en release sans la feature `tauri/custom-protocol`, Tauri active cfg(dev),
// n'embarque pas dist/ et la webview retombe sur devUrl (http://localhost:1420) —
// d'où un « Could not connect to localhost: Connection refused » au lancement.
// Seul `npm run tauri build` pose cette feature ; un `cargo build --release` nu produit
// un binaire cassé silencieusement. On préfère échouer à la compilation.
#[cfg(all(not(debug_assertions), dev))]
compile_error!(
    "build release sans frontend embarqué : utilise `npm run tauri build`, \
     pas `cargo build --release` (voir README)"
);

fn main() {
    terminials_lib::run()
}
