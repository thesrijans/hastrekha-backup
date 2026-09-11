/**
 * C2 — the greeting.
 *
 * "नमस्ते" and the visitor's name when a session gives one, "साधक" (seeker) when
 * it does not — never a guessed or placeholder name. The line under it is
 * Cormorant in gold; the paragraph is parchment cream, and it speaks the way the
 * brief's trust rule requires: what palmistry has traditionally associated with
 * the lines, never what a palm "reveals" as fact.
 */
import type { ReactElement } from "react";
import { GoldText, OrnamentalDivider } from "@/components/sanctuary/material";
import styles from "./home.module.css";

/** Who is greeted when nobody is signed in. */
export const HOME_GREETING_SEEKER = "साधक";

export const HOME_GREETING_TITLE = "Your story begins here.";

export const HOME_GREETING_BODY =
  "Your palm carries patterns that palmists have read for centuries. Traditional palmistry associates each line with a part of a life — the heart, the mind, the work, the road ahead. Let’s look at yours together.";

export interface HomeGreetingProps {
  /** The signed-in visitor's name, or null. */
  readonly name: string | null;
  readonly className?: string;
}

export function HomeGreeting({ name, className }: HomeGreetingProps): ReactElement {
  const trimmed = name?.trim() ?? "";
  return (
    <section className={className === undefined ? styles.greeting : `${styles.greeting} ${className}`}>
      <p className={styles.namaste}>
        <span lang="hi">नमस्ते,</span>{" "}
        {trimmed === "" ? <span lang="hi">{HOME_GREETING_SEEKER}</span> : <span>{trimmed}</span>}
      </p>
      <GoldText as="h2" size="title" className={styles.storyTitle}>
        {HOME_GREETING_TITLE}
      </GoldText>
      <OrnamentalDivider width={220} seed={31} className={styles.greetingDivider} />
      <p className={styles.storyBody}>{HOME_GREETING_BODY}</p>
      <OrnamentalDivider width={220} seed={47} className={styles.greetingDivider} />
    </section>
  );
}
