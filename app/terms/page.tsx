import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — HastRekha",
  description: "Service kis liye hai, aur kis liye nahi.",
};

/** Placeholder. Final wording is drafted separately and swapped in before launch. */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Terms</h1>
      <p className="mt-2 text-sm text-black/55 dark:text-white/55">Draft — launch se pehle final hoga.</p>
      <ul className="mt-8 flex flex-col gap-3 text-base leading-7 text-black/75 dark:text-white/75">
        <li>HastRekha entertainment aur self-reflection ke liye hai.</li>
        <li>Yeh medical, legal ya financial salah nahi hai. Sehat ke sawaal ke liye doctor se milo.</li>
        <li>Hum maut, bimari ya kisi bhi dar-wali bhavishyavani nahi karte.</li>
      </ul>
    </main>
  );
}
