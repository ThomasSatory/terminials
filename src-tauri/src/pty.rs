//! Gestion des PTY via portable-pty : ouverture, écriture, resize, et registre des PTY vivants.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

pub type PtyId = u32;

/// Un PTY vivant : writer pour l'entrée, master pour le resize, child gardé vivant (+ son PID).
pub struct PtyHandle {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub pid: Option<u32>,
    /// Gardé vivant pour ne pas tuer le process enfant.
    _child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyRegistry {
    next: AtomicU32,
    pub handles: Mutex<HashMap<PtyId, PtyHandle>>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn next_id(&self) -> PtyId {
        self.next.fetch_add(1, Ordering::SeqCst)
    }
}

/// Ouvre un PTY, lance `shell` dans `cwd`, enregistre le handle et retourne (id, reader).
/// Le reader est destiné à un thread lecteur dédié (lectures bloquantes).
pub fn spawn_pty(
    reg: &PtyRegistry,
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> std::io::Result<(PtyId, Box<dyn std::io::Read + Send>)> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    drop(pair.slave);

    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let id = reg.next_id();
    reg.handles
        .lock()
        .unwrap()
        .insert(id, PtyHandle { writer, master: pair.master, pid, _child: child });
    Ok((id, reader))
}

pub fn write_pty(reg: &PtyRegistry, id: PtyId, data: &[u8]) -> std::io::Result<()> {
    let mut handles = reg.handles.lock().unwrap();
    let h = handles.get_mut(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.writer.write_all(data)?;
    h.writer.flush()
}

pub fn resize_pty(reg: &PtyRegistry, id: PtyId, cols: u16, rows: u16) -> std::io::Result<()> {
    let handles = reg.handles.lock().unwrap();
    let h = handles.get(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Ferme un PTY : retire le handle du registre. Le drop du child + master ferme le fd
/// esclave → EOF côté reader → le thread lecteur se termine naturellement.
pub fn close_pty(reg: &PtyRegistry, id: PtyId) {
    reg.handles.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_assigns_unique_incrementing_ids() {
        let reg = PtyRegistry::new();
        let a = reg.next_id();
        let b = reg.next_id();
        assert_ne!(a, b);
        assert_eq!(b, a + 1);
    }

    #[test]
    fn spawn_write_resize_roundtrip() {
        let reg = PtyRegistry::new();
        let (id, _reader) = spawn_pty(&reg, "/bin/sh", "/", 80, 24).unwrap();
        assert!(reg.handles.lock().unwrap().contains_key(&id));
        write_pty(&reg, id, b"echo hi\n").unwrap();
        resize_pty(&reg, id, 100, 30).unwrap();
    }
}
