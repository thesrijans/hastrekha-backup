/**
 * <BuildStamp> — the tiny muted line that says which build this is (M0).
 *
 * One line, in the colophon's smallest voice: the short SHA and the build's
 * minute in UTC. It reads the two constants lib/build-stamp.ts inlines at
 * build, so the server, the browser and /api/version can never disagree about
 * it, and it renders the same on both sides — there is nothing to hydrate.
 *
 * This file owns the TYPE only (build-stamp.module.css). WHERE the line sits is
 * the host's: the shell pins it to the foot of its content column, the chamber
 * to its top row, each through the `className` it passes. Both hosts also own
 * the margin, so the host's placement rule and this file's type rule never
 * write the same property.
 *
 * A server component: no state, no hooks, no JavaScript of its own.
 */
import type { ReactElement } from "react";
import { BUILD_SHA, BUILD_SHA_SHORT, BUILT_AT, formatBuiltAt } from "@/lib/build-stamp";
import styles from "./build-stamp.module.css";

export interface BuildStampProps {
  /** The host's placement class. */
  readonly className?: string;
}

export function BuildStamp({ className }: BuildStampProps): ReactElement {
  return (
    <p className={[styles.stamp, className].filter(Boolean).join(" ")} data-snc-build-stamp={BUILD_SHA}>
      build {BUILD_SHA_SHORT}
      {BUILT_AT === null ? null : (
        <>
          {" · "}
          <time dateTime={BUILT_AT}>{formatBuiltAt(BUILT_AT)}</time>
        </>
      )}
    </p>
  );
}
