import { PortfolioView } from "@/components/portfolio-view";
import { Privy } from "@/components/privy-provider";

export const dynamic = "force-dynamic";

export const metadata = { title: "Portfolio — Parity" };

export default function PortfolioPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-12 md:px-8">
      <header className="mb-8">
        <h1 className="text-ink text-2xl font-medium tracking-tight">Portfolio</h1>
        <p className="text-ink-dim mt-3 max-w-prose text-sm leading-relaxed">
          What you hold, what it&rsquo;s trading for, and what it would be worth if each gap closed
          to the value behind it. That second number is a possibility, not a promise.
        </p>
      </header>

      <Privy>
        <PortfolioView />
      </Privy>
    </div>
  );
}
