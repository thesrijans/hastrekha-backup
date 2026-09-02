import { notFound } from "next/navigation";
import { LabelClient } from "./label-client";

/**
 * Dev-only ground-truth labeler (sprint Phase 0b, built in 0a-ii).
 *
 * Same hard gate as /dev/capture: any NODE_ENV other than development 404s before the client
 * bundle is referenced. The labeler renders palm crops — biometric data that lives only on the
 * developer's machine (D5).
 */
export const metadata = {
  title: "Labeler — dev",
  robots: { index: false, follow: false },
};

export default function DevLabelPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <LabelClient />;
}
