import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy — HastRekha",
  description: "Kaunsa data hum rakhte hain aur kaunsa kabhi nahi.",
};

/** Placeholder. The DPDP-compliant text is drafted separately and swapped in before launch. */
export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-muted">Draft — launch se pehle final hoga.</p>
      <ul className="mt-8 flex max-w-xl flex-col gap-3 text-base leading-7 text-muted">
        <li>Palm images tumhare device par hi process hote hain — sirf feature scores server par aate hain.</li>
        <li>Hum email, naam aur reading history rakhte hain taaki tum apni readings dobara dekh sako.</li>
        <li>Consent ka record rakha jaata hai, aur tum use kabhi bhi wapas le sakte ho.</li>
      </ul>
    </main>
  );
}
