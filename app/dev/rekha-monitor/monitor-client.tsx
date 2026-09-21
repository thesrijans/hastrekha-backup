"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import { RekhaMonitor } from "@/components/sanctuary/chamber/rekha-monitor";
import type { RekhaSnapshot } from "@/lib/scan/rekha-persist";

/** Where scripts/capture/capture-monitor.mjs puts the recorded snapshot (an init script, before hydration). */
declare global {
  interface Window {
    __REKHA_MONITOR_STATE__?: RekhaSnapshot;
  }
}

const subscribe = (): (() => void) => (): void => undefined;

export function MonitorClient(): ReactElement {
  // Read through a store with a null server snapshot: the state exists only in the browser.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => window.__REKHA_MONITOR_STATE__ ?? null,
    () => null,
  );
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "var(--color-snc-stone-900)" }} data-snc-monitor-ready={snapshot === null ? "no" : "yes"}>
      <RekhaMonitor snapshot={snapshot} visible />
    </div>
  );
}
