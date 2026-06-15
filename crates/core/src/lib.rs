//! Logique pure de terminials, indépendante de Tauri/webkit (testable sans GUI).
//! Le crate `src-tauri` dépend de ce crate et en câble les fonctions aux commandes Tauri.

pub mod git;
pub mod osc;
pub mod ports;
