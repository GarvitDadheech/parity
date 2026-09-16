import Link from "next/link";

import { TokenTable, type Feed } from "@/components/token-table";
import { loadFeed } from "@/lib/prestocks/feed";

/** Prices are the product — this page is never served from a cache. */
export const dynamic = "force-dynamic";

export default async function HomePage() {
  // Render the table with real numbers on the first paint rather than a
  // skeleton that resolves a moment later. The client takes over refreshing.
  let initial: Feed | null = null;
  try {
    initial = (await loadFeed()) as Feed;
  } catch {
    // The client component retries and shows its own error state.
  }

  const widest = initial?.tokens[0];

  return (
    <div className="mx-auto w-full max-w-6xl px-5 md:px-8">
      <section className="rise border-hairline border-b py-16 md:py-24">
        <p className="text-accent mb-5 text-[10px] tracking-[0.14em] uppercase">
          Fair value for tokenized pre-IPO stocks
        </p>

        <h1 className="text-ink max-w-3xl text-3xl leading-[1.15] font-medium tracking-tight text-balance md:text-4xl">
          Every PreStock has two prices. Almost nobody is looking at the gap.
        </h1>

        <div className="text-ink-dim mt-6 max-w-prose space-y-4 text-sm leading-relaxed">
          <p>
            A PreStock is backed 1:1 by an SPV holding the real private company. That backing has
            a value — the <span className="text-ink">NAV</span>. The token also has a market
            price, set by whoever is trading it on Solana today. Those two numbers are not the
            same, and the difference is the entire opportunity.
          </p>
          {widest && (
            <p>
              Right now{" "}
              <Link href={`/t/${widest.symbol}`} className="text-ink hover:text-accent underline decoration-hairline-strong underline-offset-4 transition-colors duration-100">
                {widest.symbol}
              </Link>{" "}
              trades{" "}
              <span className={widest.premiumPct < 0 ? "text-discount" : "text-premium"}>
                {Math.abs(widest.premiumPct).toFixed(1)}%{" "}
                {widest.premiumPct < 0 ? "below" : "above"}
              </span>{" "}
              what it is backed by. Parity finds that gap across every listed company, alerts you
              when it crosses your threshold, and can act on it for you.
            </p>
          )}
        </div>

        <p className="text-ink-faint mt-6 max-w-prose text-xs leading-relaxed">
          This is not arbitrage. There is no second exchange to close the gap against — these are
          private companies, and a discount can persist. It is exposure to quality at a price
          below its backing, which is a thesis, not a guarantee.
        </p>
      </section>

      <section className="py-12" aria-labelledby="markets-heading">
        <h2 id="markets-heading" className="sr-only">
          Live markets
        </h2>
        <TokenTable initial={initial} />
      </section>

      <HowItWorks />
      <Honesty />
    </div>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Watch the gap",
      body: "Parity polls the PreStocks feed continuously and computes each token's distance from the value it's backed by. Every figure on this page is live.",
    },
    {
      n: "02",
      title: "Set a threshold",
      body: "In Telegram: “alert me when SpaceX trades 15% below NAV.” One message when it crosses, and it re-arms only once the gap retreats — so it never spams you at the boundary.",
    },
    {
      n: "03",
      title: "Let it act, inside limits",
      body: "Authorize a server signer on your own embedded wallet and Parity can execute the trade the moment it crosses — capped per trade and per day, with a kill switch that stops everything instantly.",
    },
  ];

  return (
    <section className="border-hairline border-t py-16" aria-labelledby="how-heading">
      <h2 id="how-heading" className="text-ink text-lg font-medium tracking-tight">
        How it works
      </h2>

      <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
        {steps.map((step) => (
          <li key={step.n}>
            <span className="text-accent tnum text-[10px] tracking-[0.14em]">{step.n}</span>
            <h3 className="text-ink mt-3 text-sm font-medium">{step.title}</h3>
            <p className="text-ink-dim mt-2 text-xs leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * The risks, stated plainly.
 *
 * These are real properties of the PreStocks mints, read from the chain rather
 * than from marketing copy. Surfacing them is the point: a product that moves
 * someone's money should be the one that tells them what it found.
 */
function Honesty() {
  const risks = [
    {
      title: "The gap may never close",
      body: "Nothing forces a PreStock to trade at its backing. A discount can widen, or persist for as long as you hold.",
    },
    {
      title: "The issuer holds a permanent delegate",
      body: "These are Token-2022 mints with a permanent delegate authority, which means the issuer can move tokens out of any account. That is counterparty risk you are taking on.",
    },
    {
      title: "Transfers carry a fee and can be paused",
      body: "The mints charge a transfer fee on every movement and carry a pausable flag. Parity reads both from the chain and refuses to quote a paused token.",
    },
  ];

  return (
    <section className="border-hairline border-t py-16" aria-labelledby="risk-heading">
      <h2 id="risk-heading" className="text-ink text-lg font-medium tracking-tight">
        What we found that you should know
      </h2>
      <p className="text-ink-dim mt-2 max-w-prose text-xs leading-relaxed">
        Read directly from the mints on Solana mainnet, not from a brochure.
      </p>

      <dl className="mt-8 grid gap-8 md:grid-cols-3 md:gap-10">
        {risks.map((risk) => (
          <div key={risk.title}>
            <dt className="text-ink text-sm font-medium">{risk.title}</dt>
            <dd className="text-ink-dim mt-2 text-xs leading-relaxed">{risk.body}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
