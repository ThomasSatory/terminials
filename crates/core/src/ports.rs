//! Détection des ports TCP en écoute ouverts par le sous-arbre de process d'un PTY (Linux /proc).

use std::collections::{HashMap, HashSet};

/// Parse /proc/net/tcp(6) : retourne inode -> port, uniquement pour l'état LISTEN (0A).
pub fn parse_listening(content: &str) -> HashMap<u64, u16> {
    let mut out = HashMap::new();
    for line in content.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 {
            continue;
        }
        if cols[3] != "0A" {
            continue; // 0A = TCP_LISTEN
        }
        let local = cols[1]; // "IP:PORT" en hexa
        if let Some((_, port_hex)) = local.split_once(':') {
            if let Ok(port) = u16::from_str_radix(port_hex, 16) {
                if let Ok(inode) = cols[9].parse::<u64>() {
                    out.insert(inode, port);
                }
            }
        }
    }
    out
}

/// Collecte récursivement les PID du sous-arbre de `root_pid` (via /proc/<pid>/task/<tid>/children).
fn descendant_pids(root_pid: u32) -> HashSet<u32> {
    let mut seen = HashSet::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) {
            continue;
        }
        let task_dir = format!("/proc/{pid}/task");
        if let Ok(entries) = std::fs::read_dir(&task_dir) {
            for e in entries.flatten() {
                let children = e.path().join("children");
                if let Ok(s) = std::fs::read_to_string(&children) {
                    for c in s.split_whitespace() {
                        if let Ok(cpid) = c.parse::<u32>() {
                            stack.push(cpid);
                        }
                    }
                }
            }
        }
    }
    seen
}

/// Inodes des sockets ouverts par un PID (symlinks /proc/<pid>/fd/* -> socket:[inode]).
fn socket_inodes_of(pid: u32) -> HashSet<u64> {
    let mut inodes = HashSet::new();
    let fd_dir = format!("/proc/{pid}/fd");
    if let Ok(entries) = std::fs::read_dir(&fd_dir) {
        for e in entries.flatten() {
            if let Ok(target) = std::fs::read_link(e.path()) {
                let t = target.to_string_lossy();
                if let Some(rest) = t.strip_prefix("socket:[") {
                    if let Some(num) = rest.strip_suffix(']') {
                        if let Ok(inode) = num.parse::<u64>() {
                            inodes.insert(inode);
                        }
                    }
                }
            }
        }
    }
    inodes
}

/// Ports TCP en écoute ouverts par le sous-arbre de process de `root_pid`.
pub fn listening_ports(root_pid: u32) -> Vec<u16> {
    let mut inode_to_port = parse_listening(&std::fs::read_to_string("/proc/net/tcp").unwrap_or_default());
    inode_to_port.extend(parse_listening(&std::fs::read_to_string("/proc/net/tcp6").unwrap_or_default()));
    let pids = descendant_pids(root_pid);
    let mut ports: HashSet<u16> = HashSet::new();
    for pid in pids {
        for inode in socket_inodes_of(pid) {
            if let Some(port) = inode_to_port.get(&inode) {
                ports.insert(*port);
            }
        }
    }
    let mut v: Vec<u16> = ports.into_iter().collect();
    v.sort_unstable();
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listening_ports_from_proc_net_tcp() {
        // st=0A = LISTEN. local_address = IP(hexa LE):PORT(hexa BE). 0100007F:1F90 = 127.0.0.1:8080.
        let sample = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0000 100 0 0 10 0
   1: 0100007F:1F91 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 99999 1 0000 100 0 0 10 0
";
        let map = parse_listening(sample);
        assert_eq!(map.get(&12345), Some(&8080));
        assert!(!map.contains_key(&99999)); // état 01 (ESTABLISHED) ignoré
    }
}
