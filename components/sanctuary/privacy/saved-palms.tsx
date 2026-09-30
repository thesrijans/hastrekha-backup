"use client";

/**
 * The privacy leaf's one control (scan-complete G4.3): the palms this device keeps for HastRekha's growth — the
 * completion leaf's opt-in — counted, and deletable in one tap. They never left the device; this is where they
 * leave it for good. Reads the snap store without its session purge, and draws nothing until it knows.
 */
import { useEffect, useState, type ReactElement } from "react";
import { openSnapStore } from "@/lib/scan/snap-store";
import styles from "./saved-palms.module.css";

export function SavedPalms(): ReactElement | null {
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const store = await openSnapStore({ purge: false });
      const saved = store === null ? 0 : (await store.listGrowth()).length;
      if (alive) setCount(saved);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (count === null) return null;

  const deleteAll = (): void => {
    setBusy(true);
    void (async () => {
      const store = await openSnapStore({ purge: false });
      if (store !== null) await store.deleteAllGrowth();
      setCount(0);
      setBusy(false);
    })();
  };

  return (
    <li data-snc-saved-palms={count}>
      {count === 0
        ? "Is device par koi hatheli sahej kar nahi rakhi gayi."
        : `Is device par ${count} hatheli tumhari marzi se sahej kar rakhi ${count === 1 ? "hai" : "hain"} — HastRekha ko behtar banane ke liye.`}
      {count > 0 ? (
        <button type="button" className={styles.remove} onClick={deleteAll} disabled={busy} data-snc-saved-palms-delete="">
          Sab hatao
        </button>
      ) : null}
    </li>
  );
}
