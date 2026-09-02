import { notFound } from "next/navigation";
import { CaptureClient } from "./capture-client";

/**
 * Dev-only ground-truth capture harness (sprint Phase 0a).
 *
 * Hard-gated to development: any other NODE_ENV — production builds included — 404s before the
 * client bundle is even referenced. Raw palm frames are biometric data; this page exists only on
 * the developer's own machine.
 */
export const metadata = {
  title: "Capture harness — dev",
  robots: { index: false, follow: false },
};

export default function DevCapturePage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <CaptureClient />;
}
