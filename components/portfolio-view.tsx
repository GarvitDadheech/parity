"use client";

import Link from "next/link";

import { AuthedPanel } from "@/components/authed-panel";
import { CopyableAddress } from "@/components/copyable";
import { ColumnLabel, GapValue } from "@/components/numbers";
import { signedPct, timeAgo, tokenAmount, usd } from "@/lib/format";
import { solscanTx } from "@/lib/solana/connection";

interface Position {
  symbol: string;
  name: string;
  tokens: number;
  markPrice: number;
  tokenPrice: number;
  marketValue: number;
  navValue: number;
  navUpside: number;
  premiumPct: number;
}

interface TradeRow {
  id: number;
  kind: string;
  symbol: string;
  usdcAmount: number | null;
  tokenAmount: number | null;
  premiumAtExec: number;
  txSig: string | null;
  status: string;
  dryRun: boolean;
  createdAt: string;
}

interface PortfolioData {
  linked: boolean;
  walletAddress: string | null;
  paused?: boolean;
  limits?: { maxTradeUsdc: number; dailyCapUsdc: number; slippageBps: number; spentToday: number };
  cash?: { usdc: number; sol: number };
  positions: Position[];
  trades: TradeRow[];
}

export function PortfolioView() {
  return (
    <AuthedPanel<PortfolioData>
      endpoint="/api/portfolio"
      refreshMs={30_000}
      emptyTitle="No Parity account yet"
      emptyBody={
        <p>
          Send <code className="text-ink">/login</code> to the Parity bot in Telegram. That link is
          what connects this wallet to your chat.
        </p>
      }
    >
      {(data) => {
        const totalMarket = data.positions.reduce((sum, p) => sum + p.marketValue, 0);
        const totalNav = data.positions.reduce((sum, p) => sum + p.navValue, 0);
        const gap = totalNav - totalMarket;
        const blended = totalNav > 0 ? ((totalMarket - totalNav) / totalNav) * 100 : 0;

        return (
          <div className="rise">
            <section className="border-hairline grid grid-cols-2 gap-x-6 gap-y-6 border-b pb-8 md:grid-cols-4">
              <Stat label="Market value" value={usd(totalMarket)} />
              <Stat label="Value at NAV" value={usd(totalNav)} muted />
              <Stat
                label="Gap to fair value"
                value={`${gap >= 0 ? "+" : "−"}${usd(Math.abs(gap))}`}
                tone={gap > 0 ? "discount" : gap < 0 ? "premium" : "neutral"}
              />
              <div>
                <ColumnLabel>Blended gap</ColumnLabel>
                <p className="mt-1.5 text-xl">
                  <GapValue premiumPct={blended} />
                </p>
              </div>
            </section>

            <section className="border-hairline flex flex-wrap items-center gap-x-8 gap-y-3 border-b py-5">
              {data.cash && (
                <>
                  <MiniStat label="USDC" value={usd(data.cash.usdc)} />
                  <MiniStat label="SOL" value={data.cash.sol.toFixed(4)} />
                </>
              )}
              {data.limits && (
                <MiniStat
                  label="Spent today"
                  value={`${usd(data.limits.spentToday)} / ${usd(data.limits.dailyCapUsdc)}`}
                />
              )}
              {data.walletAddress && (
                <div className="ml-auto">
                  <CopyableAddress address={data.walletAddress} chars={6} />
                </div>
              )}
            </section>

            {data.paused && (
              <p className="text-premium border-hairline border-b py-4 text-xs">
                Automation is paused. Send <code>/resume</code> in Telegram to re-enable it.
              </p>
            )}

            <section className="py-8" aria-labelledby="positions-heading">
              <h2 id="positions-heading" className="text-ink mb-5 text-sm font-medium">
                Positions
              </h2>

              {data.positions.length === 0 ? (
                <p className="text-ink-dim max-w-prose text-xs leading-relaxed">
                  Nothing held yet. The{" "}
                  <Link href="/" className="text-accent underline underline-offset-4">
                    markets table
                  </Link>{" "}
                  shows which companies are trading furthest below what they&rsquo;re backed by.
                </p>
              ) : (
                <ul>
                  {data.positions.map((position) => (
                    <li key={position.symbol} className="border-hairline border-b last:border-b-0">
                      <Link
                        href={`/t/${position.symbol}`}
                        className="hover:bg-surface-hover grid grid-cols-2 gap-x-4 gap-y-1 px-1 py-4 transition-colors duration-100 md:grid-cols-[minmax(0,1fr)_8rem_8rem_7rem] md:items-baseline"
                      >
                        <div className="col-span-2 md:col-span-1">
                          <span className="tnum text-ink text-sm font-medium">
                            {position.symbol}
                          </span>
                          <span className="text-ink-dim ml-2 text-xs">
                            {tokenAmount(position.tokens)} tokens
                          </span>
                        </div>
                        <div className="md:text-right">
                          <span className="md:hidden">
                            <ColumnLabel>Market</ColumnLabel>
                          </span>
                          <span className="tnum text-ink text-sm">{usd(position.marketValue)}</span>
                        </div>
                        <div className="md:text-right">
                          <span className="md:hidden">
                            <ColumnLabel>At NAV</ColumnLabel>
                          </span>
                          <span className="tnum text-ink-dim text-sm">{usd(position.navValue)}</span>
                        </div>
                        <div className="md:text-right">
                          <span className="md:hidden">
                            <ColumnLabel>Gap</ColumnLabel>
                          </span>
                          <GapValue premiumPct={position.premiumPct} className="text-sm" />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="border-hairline border-t py-8" aria-labelledby="trades-heading">
              <h2 id="trades-heading" className="text-ink mb-5 text-sm font-medium">
                Trade history
              </h2>

              {data.trades.length === 0 ? (
                <p className="text-ink-dim text-xs">No trades yet.</p>
              ) : (
                <ul className="space-y-px">
                  {data.trades.map((trade) => (
                    <li
                      key={trade.id}
                      className="border-hairline flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
                    >
                      <span className="tnum text-ink w-20 text-xs">{trade.symbol}</span>
                      <span className="text-ink-dim w-24 text-xs">{labelFor(trade.kind)}</span>
                      <span className="tnum text-ink w-24 text-xs">
                        {trade.usdcAmount != null ? usd(trade.usdcAmount) : "—"}
                      </span>
                      <span className="tnum text-ink-dim w-16 text-xs">
                        {signedPct(trade.premiumAtExec, 1)}
                      </span>
                      <StatusPill status={trade.status} dryRun={trade.dryRun} />
                      <span className="text-ink-faint tnum ml-auto text-[11px]">
                        {timeAgo(trade.createdAt)}
                      </span>
                      {trade.txSig && (
                        <a
                          href={solscanTx(trade.txSig)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent hover:text-ink text-[11px] underline underline-offset-4 transition-colors duration-100"
                        >
                          tx
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        );
      }}
    </AuthedPanel>
  );
}

function labelFor(kind: string): string {
  return (
    {
      manual_buy: "Buy",
      manual_sell: "Sell",
      auto_buy: "Auto buy",
      auto_sell: "Auto sell",
    }[kind] ?? kind
  );
}

function StatusPill({ status, dryRun }: { status: string; dryRun: boolean }) {
  if (dryRun || status === "dry_run") {
    return <span className="text-ink-faint text-[11px]">dry run</span>;
  }
  const tone =
    status === "confirmed" ? "text-discount" : status === "failed" ? "text-premium" : "text-ink-dim";
  return <span className={`${tone} text-[11px]`}>{status}</span>;
}

function Stat({
  label,
  value,
  muted,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  tone?: "discount" | "premium" | "neutral";
}) {
  const toneClass =
    tone === "discount" ? "text-discount" : tone === "premium" ? "text-premium" : "text-ink";
  return (
    <div>
      <ColumnLabel>{label}</ColumnLabel>
      <p className={`tnum mt-1.5 text-xl ${muted ? "text-ink-dim" : toneClass}`}>{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-ink-faint text-[10px] tracking-[0.08em] uppercase">{label}</span>
      <span className="tnum text-ink text-xs">{value}</span>
    </div>
  );
}
