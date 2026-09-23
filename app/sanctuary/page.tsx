import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactElement } from "react";
import { HomeContent } from "@/components/sanctuary/home/home-content";
import { HomeMasthead } from "@/components/sanctuary/home/home-masthead";
import homeStyles from "@/components/sanctuary/home/home.module.css";
import { PATHS_LIST_ID } from "@/components/sanctuary/home/path-cards";
import { ProfileControl } from "@/components/sanctuary/home/profile-control";
import { HomeRoom } from "@/components/sanctuary/room/home-room";
import { RoomStage } from "@/components/sanctuary/room/room-stage";
import { Room3D } from "@/components/sanctuary/room/three/room-3d";
import { SanctuaryShell } from "@/components/sanctuary/shell/sanctuary-shell";
import { Threshold } from "@/components/sanctuary/threshold/threshold";
import { getSessionUserFromCookies, type SessionUser } from "@/lib/auth/session";
import { SANCTUARY_FONT_CLASS } from "@/lib/sanctuary/fonts";
import { SanctuaryHomeIsland } from "./home-island";

/**
 * ============================================================================
 * /sanctuary — Home: the Threshold, the room, and the content below it.
 * ============================================================================
 *
 * U3a. A complete Home with no WebGL anywhere: the room is B7's CSS
 * composition, which is also the first paint the 3D room (U3b) will fade in
 * over. Behind the same sanctuary flag as the chamber and the pothi
 * (NEXT_PUBLIC_SANCTUARY=1 at build), with noindex beside it.
 *
 * WHAT IS ON THE PAGE, IN ORDER:
 *
 *  · the Threshold (Part D) — first visit only, decided before first paint;
 *  · the room (B7 + B5) on a wide landscape screen, OR the vertical scene on
 *    everything else: the masthead (C1), then the pedestal-and-hologram
 *    vignette beside the greeting (M1.1) — the 3D room in it, at the phone
 *    profile, on a phone that can. Both are rendered and the stylesheet
 *    chooses, so there is never a server guess about the viewport and never a
 *    layout that changes after hydration;
 *  · Part C's content — greeting, the one action, the tradition's palm, the
 *    five paths, the verse, the colophon;
 *  · one island, which renders nothing (see home-island.tsx).
 *
 * THE VISITOR'S NAME comes from the session cookie, read on the server. Reading
 * it makes this route dynamic, which is the honest cost of greeting someone by
 * name. With no cookie there is no database call at all; with a database that
 * cannot be reached, the greeting falls back to "साधक" rather than taking the
 * front door down with it.
 */
export const metadata: Metadata = {
  title: "Sanctuary — dev",
  robots: { index: false, follow: false },
};

/** The bottom bar pads itself clear of the home indicator; `env(safe-area-inset-*)` is 0 unless the page extends under it. */
export const viewport: Viewport = {
  viewportFit: "cover",
};

/** The ground's seed — Home's own stone, distinct from the Pothi's and the bench's. */
const GROUND_SEED = 1723;

/** The two framings of the room; the island finds them by these. */
const ROOM_ID = "snc-room";
const VIGNETTE_ID = "snc-vignette";

async function visitorOrNull(): Promise<SessionUser | null> {
  try {
    return await getSessionUserFromCookies();
  } catch {
    return null;
  }
}

export default async function SanctuaryHomePage(): Promise<ReactElement> {
  // THE SANCTUARY FLAG (D1.1). The route opens on one thing: NEXT_PUBLIC_SANCTUARY
  // === "1" when `next build` ran. A NEXT_PUBLIC_ variable is inlined at build
  // time — into server code as well as client — so a build made without it
  // bakes this route as a 404 and a build made with it serves the room, and
  // nothing at runtime can flip either. It replaced the development-only gate
  // and the SNC_MEASURE lift the loop harness used to open it on a production
  // build: a preview deploy, scripts/capture/ and a local `next dev` now all
  // open the sanctuary the same way, by setting the flag.
  //
  // Why an explicit "1" and not merely "set": an empty or accidental value
  // must not open the route. The `robots: noindex` above still covers it.
  if (process.env.NEXT_PUBLIC_SANCTUARY !== "1") notFound();

  const visitor = await visitorOrNull();
  const signedIn = visitor !== null;

  return (
    <SanctuaryShell activeHref="/sanctuary" groundSeed={GROUND_SEED} className={SANCTUARY_FONT_CLASS} header={false}>
      <Threshold />

      <HomeRoom
        id={ROOM_ID}
        className={homeStyles.roomOnly}
        profile={<ProfileControl signedIn={signedIn} id="profile-room" />}
      />

      <div className={homeStyles.portraitOnly}>
        <HomeMasthead profile={<ProfileControl signedIn={signedIn} id="profile-masthead" />} />
      </div>

      <HomeContent
        name={visitor?.name ?? null}
        hero={
          <RoomStage
            id={VIGNETTE_ID}
            variant="vignette"
            className={homeStyles.vignetteBand}
            scene={<Room3D roomId={VIGNETTE_ID} profile="phone" />}
          />
        }
      />

      <SanctuaryHomeIsland roomIds={[ROOM_ID, VIGNETTE_ID]} pathsId={PATHS_LIST_ID} />
    </SanctuaryShell>
  );
}
