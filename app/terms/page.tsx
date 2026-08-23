import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms — HastRekha",
  description: "Service kis liye hai, aur kis liye nahi.",
};

/** Placeholder. Final wording is drafted separately and swapped in before launch. */
export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Terms</h1>
      <p className="mt-2 text-sm text-muted">Draft — launch se pehle final hoga.</p>
      <ul className="mt-8 flex max-w-xl flex-col gap-3 text-base leading-7 text-muted">
        <li>HastRekha entertainment aur self-reflection ke liye hai.</li>
        <li>Yeh medical, legal ya financial salah nahi hai. Sehat ke sawaal ke liye doctor se milo.</li>
        <li>Hum maut, bimari ya kisi bhi dar-wali bhavishyavani nahi karte.</li>
      </ul>
    </main>
  );
}
