import { invoke, Channel } from "@tauri-apps/api/core";

export interface Pty {
  id: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
}

/** Lance un PTY côté Rust et câble sa sortie brute sur `onData`. */
export async function spawnPty(
  opts: { workspaceId: string; shell: string; cwd: string; cols: number; rows: number },
  onData: (bytes: Uint8Array) => void,
): Promise<Pty> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (msg) => onData(new Uint8Array(msg));
  const id = await invoke<number>("spawn_pty", {
    workspaceId: opts.workspaceId,
    shell: opts.shell,
    cwd: opts.cwd,
    cols: opts.cols,
    rows: opts.rows,
    onData: channel,
  });
  return {
    id,
    write: (data) =>
      void invoke("write_pty", { id, data: Array.from(new TextEncoder().encode(data)) }),
    resize: (cols, rows) => void invoke("resize_pty", { id, cols, rows }),
  };
}
