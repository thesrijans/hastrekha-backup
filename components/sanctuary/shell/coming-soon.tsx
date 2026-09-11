/**
 * A room that is not built yet — a control that says so, and goes nowhere.
 *
 * A4's rule is exact: "Routes that don't exist yet render disabled with 'जल्द आ
 * रहा है' … never a dead link." So this is a `<button>`, never an `<a>`: there is
 * no href to follow into a 404, no route prefetched, nothing for a crawler to
 * index. `aria-disabled` rather than `disabled`, because a disabled button cannot
 * be focused or tapped, and a reader who cannot tap it cannot find out why it is
 * dim.
 *
 * WHAT A TAP DOES. It opens a small note — the room's name and "जल्द आ रहा है" —
 * through the Popover API: `popovertarget` on the button, `popover="auto"` on the
 * note. The browser does the opening, the light-dismiss and the Escape key, so
 * the control ships no JavaScript at all. Hover is the stylesheet's job where a
 * surface has hover (the rail shows the words in place); a phone has no hover,
 * and the note is what it gets instead.
 *
 * WHERE THE NOTE OPENS. Beside its control, through CSS anchor positioning, where
 * the browser has it. Where it does not, the note opens at a fixed place that
 * belongs to its surface — over the bottom bar, or beside the rail — which is
 * why `placement` is a prop: a fallback position is a fact about the surface,
 * not about the room.
 */
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { SanctuaryCameraTarget } from "@/lib/sanctuary/nav";
import { SANCTUARY_COMING_SOON_EN, SANCTUARY_COMING_SOON_HI } from "@/lib/sanctuary/routes";
import styles from "./coming-soon.module.css";

export interface ComingSoonProps {
  /** Unique on the page. The note's id and the anchor's name are derived from it. */
  readonly id: string;
  /** The room's name, for the note and the accessible name. */
  readonly label: string;
  /** Where the note opens when the browser cannot anchor it. */
  readonly placement: "bar" | "rail" | "inline";
  /** The control's face — a glyph, a label, whatever its surface draws. */
  readonly children: ReactNode;
  readonly className?: string;
  /** Where the room's camera goes on Home when this is pressed. The route still does not open. */
  readonly camera?: SanctuaryCameraTarget | null;
}

/** The note's id, for a test or a caller that needs to find it. */
export function comingSoonNoteId(id: string): string {
  return `snc-soon-${id}`;
}

export function ComingSoon({ id, label, placement, children, className, camera = null }: ComingSoonProps): ReactElement {
  const noteId = comingSoonNoteId(id);
  /* One custom property names the anchor on both ends: the button declares it,
     the note positions against it. */
  const anchor = { "--snc-soon-anchor": `--${noteId}` } as CSSProperties;
  return (
    <>
      <button
        type="button"
        className={className === undefined ? styles.trigger : `${styles.trigger} ${className}`}
        aria-disabled="true"
        aria-label={`${label} — ${SANCTUARY_COMING_SOON_EN}`}
        popoverTarget={noteId}
        style={anchor}
        data-snc-soon={id}
        data-snc-camera={camera ?? undefined}
      >
        {children}
      </button>
      <span id={noteId} popover="auto" className={`${styles.note} snc-gold-border`} data-placement={placement} style={anchor}>
        <span className={styles.noteLabel}>{label}</span>
        <span className={styles.noteHi} lang="hi">
          {SANCTUARY_COMING_SOON_HI}
        </span>
      </span>
    </>
  );
}
