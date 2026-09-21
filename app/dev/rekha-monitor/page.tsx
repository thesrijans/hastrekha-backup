import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { SanctuaryDefs } from "@/components/sanctuary/material";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import { MonitorClient } from "./monitor-client";

/**
 * Dev-only: the Rekha Monitor alone, fed a recorded snapshot — for the S1.4
 * capture ("two lines confirmed and one tracking") that a live chamber cannot
 * be photographed in without a hand at a camera.
 *
 * The snapshot is the real one: scripts/scan/replay-persist.ts --monitor-state
 * writes the first moment of the session replay with two lines CONFIRMED and one
 * TRACKING, and scripts/capture/capture-monitor.mjs hands it to this page. The
 * component is the chamber's own; only the camera behind it is absent.
 *
 * Gated like /dev/capture and /dev/label, with the sanctuary routes' one lift
 * (SNC_MEASURE=1 at build time) so the saved capture method — a production
 * build, the real GPU — can reach it.
 */
export const metadata: Metadata = {
  title: "Rekha monitor — dev",
  robots: { index: false, follow: false },
};

export default function RekhaMonitorPage(): ReactElement {
  if (process.env.NODE_ENV !== "development" && process.env.SNC_MEASURE !== "1") notFound();
  return (
    <main className={SANCTUARY_FONT_CLASS}>
      <SanctuaryDefs />
      <MonitorClient />
    </main>
  );
}
