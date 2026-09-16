import { PoliciesView } from "@/components/policies-view";
import { Privy } from "@/components/privy-provider";

export const dynamic = "force-dynamic";

export const metadata = { title: "Automation — Parity" };

export default function PoliciesPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-12 md:px-8">
      <header className="mb-8">
        <h1 className="text-ink text-2xl font-medium tracking-tight">Automation</h1>
        <p className="text-ink-dim mt-3 max-w-prose text-sm leading-relaxed">
          Every rule Parity is running for you, and the switch that stops all of them at once.
        </p>
      </header>

      <Privy>
        <PoliciesView />
      </Privy>
    </div>
  );
}
