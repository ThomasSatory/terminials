import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";

/** Dossier personnel (résolu une fois, partagé) : les chemins s'affichent abrégés en « ~ ». */
let memo: Promise<string | null> | null = null;

export function useHome(): string | null {
  const [home, setHome] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    memo ??= homeDir().catch(() => null);
    void memo.then((h) => {
      if (vivant) setHome(h);
    });
    return () => {
      vivant = false;
    };
  }, []);
  return home;
}
