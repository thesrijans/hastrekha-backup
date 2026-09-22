import type { NextConfig } from "next";

/**
 * The front door (D1.1). A build made with NEXT_PUBLIC_SANCTUARY=1 — the flag
 * /sanctuary, /scan/chamber and /read/pothi open on — also sends "/" to the
 * sanctuary, so the deploy's root URL is the room and not the pre-sanctuary
 * home. Without the flag there is no redirect and "/" is the page it always
 * was. Temporary (307): it follows a flag, so nothing should cache it.
 *
 * Read when Next calls redirects(), which it does once, at build, after the
 * .env files are loaded — the same moment the pages' copy of the flag is
 * inlined, so the two can never disagree within a build.
 */
const nextConfig: NextConfig = {
  async redirects() {
    if (process.env.NEXT_PUBLIC_SANCTUARY !== "1") return [];
    return [{ source: "/", destination: "/sanctuary", permanent: false }];
  },
};

export default nextConfig;
