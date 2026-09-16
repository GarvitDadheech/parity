import Link from "next/link";
import { notFound } from "next/navigation";

import { CopyableAddress } from "@/components/copyable";
import { NavChart } from "@/components/nav-chart";
import { ColumnLabel } from "@/components/numbers";
import { compactUsd, signedPct, usd } from "@/lib/format";
import { displayName, findBySymbol } from "@/lib/prestocks/client";
import { VERDICT_LABEL } from "@/lib/prestocks/math";
import { solscanToken } from "@/lib/solana/connection";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/t/[symbol]">) {
  const { symbol } = await props.params;
  const token = await findBySymbol(symbol).catch(() => undefined);
  if (!token) return { title: "Not found — Parity" };

  return {
    title: `${token.symbol} — ${signedPct(token.premiumPct, 1)} to fair value · Parity`,
    description: `${displayName(token)} trades at ${usd(token.tokenPrice)} against ${usd(
      token.markPrice,
    )} of backing.`,
  };
}

export default async function TokenPage(props: PageProps<"/t/[symbol]">) {
  const { symbol } = await props.params;
  const token = await findBySymbol(symbol).catch(() => undefined);
  if (!token) notFound();

  const below = token.premiumPct < 0;
  const toneClass = token.premiumPct <= -3 ? "text-discount" : token.premiumPct >= 3 ? "text-premium" : "text-ink-dim";

  return (
    <div className="mx-auto w-full max-w-6xl px-5 md:px-8">
      <nav className="border-hairline border-b py-4">
        <Link
          href="/"
          className="text-ink-dim hover:text-ink text-xs transition-colors duration-100"
        >
          ← All markets
        </Link>
      </nav>

      <header className="rise border-hairline border-b py-10">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="tnum text-ink text-2xl font-medium tracking-tight">{token.symbol}</h1>
          <span className="text-ink-dim text-sm">{displayName(token)}</span>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-4">
          <Metric label="Market price" value={usd(token.tokenPrice)} />
          <Metric label="NAV (backed)" value={usd(token.markPrice)} muted />
          <Metric
            label="Gap to fair value"
            value={signedPct(token.premiumPct, 2)}
            className={toneClass}
          />
          <Metric label="Verdict" value={VERDICT_LABEL[token.verdict]} small />
        </div>

        <p className="text-ink-dim mt-8 max-w-prose text-sm leading-relaxed">
          {token.symbol} trades{" "}
          <span className={toneClass}>
            {Math.abs(token.premiumPct).toFixed(1)}% {below ? "below" : "above"}
          </span>{" "}
          the value of the SPV backing it. At the market price the whole company is implied to be
          worth {compactUsd(token.impliedValuation)}, against {compactUsd(token.markValuation)} at
          NAV — a difference of{" "}
          {compactUsd(Math.abs(token.impliedValuation - token.markValuation))}.
        </p>
      </header>

      <section className="border-hairline border-b py-10" aria-labelledby="chart-heading">
        <h2 id="chart-heading" className="text-ink mb-1 text-sm font-medium">
          Market price vs NAV
        </h2>
        <p className="text-ink-faint mb-6 text-xs">Last 24 hours, from Parity&rsquo;s own snapshots.</p>
        <NavChart symbol={token.symbol} />
      </section>

      <section className="border-hairline border-b py-10" aria-labelledby="about-heading">
        <h2 id="about-heading" className="text-ink text-sm font-medium">
          About {displayName(token)}
        </h2>
        <p className="text-ink-dim mt-3 max-w-prose text-sm leading-relaxed whitespace-pre-line">
          {token.description}
        </p>
      </section>

      <section className="py-10" aria-labelledby="onchain-heading">
        <h2 id="onchain-heading" className="text-ink text-sm font-medium">
          On-chain
        </h2>
        <dl className="mt-5 grid gap-5 md:grid-cols-3">
          <div>
            <dt>
              <ColumnLabel>Mint</ColumnLabel>
            </dt>
            <dd className="mt-1 flex flex-wrap items-center gap-3">
              <CopyableAddress address={token.contract_address} chars={6} />
              <a
                href={solscanToken(token.contract_address)}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-ink text-xs underline underline-offset-4 transition-colors duration-100"
              >
                Solscan
              </a>
            </dd>
          </div>
          <div>
            <dt>
              <ColumnLabel>Supply</ColumnLabel>
            </dt>
            <dd className="tnum text-ink mt-1 text-xs">
              {token.supply.toLocaleString("en-US", { maximumFractionDigits: 2 })}
            </dd>
          </div>
          <div>
            <dt>
              <ColumnLabel>Issuer page</ColumnLabel>
            </dt>
            <dd className="mt-1">
              <a
                href={token.external_url}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-ink text-xs underline underline-offset-4 transition-colors duration-100"
              >
                prestocks.com
              </a>
            </dd>
          </div>
        </dl>

        <p className="text-ink-faint mt-8 max-w-prose text-xs leading-relaxed">
          To trade this, open Parity in Telegram and send{" "}
          <code className="text-ink-dim">/buy {token.symbol} 50</code>, or arm it with{" "}
          <code className="text-ink-dim">/autobuy {token.symbol} 15 50</code> to buy automatically
          when the discount reaches 15%. Not financial advice.
        </p>
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  className = "text-ink",
  muted,
  small,
}: {
  label: string;
  value: string;
  className?: string;
  muted?: boolean;
  small?: boolean;
}) {
  return (
    <div>
      <ColumnLabel>{label}</ColumnLabel>
      <p
        className={`tnum mt-1.5 ${small ? "text-sm" : "text-xl"} ${
          muted ? "text-ink-dim" : className
        }`}
      >
        {value}
      </p>
    </div>
  );
}
