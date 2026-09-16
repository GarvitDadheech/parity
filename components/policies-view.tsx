"use client";

import { useIdentityToken } from "@privy-io/react-auth";
import { useCallback, useState } from "react";

import { AuthedPanel } from "@/components/authed-panel";
import { ColumnLabel } from "@/components/numbers";
import { usd } from "@/lib/format";

interface WatchRow {
  id: number;
  symbol: string;
  direction: string;
  thresholdPct: number;
}

interface PolicyRow {
  id: number;
  kind: string;
  symbol: string;
  thresholdPct: number;
  amountUsdc: number | null;
  amountToken: number | null;
}

interface PoliciesData {
  linked: boolean;
  paused?: boolean;
  limits?: { maxTradeUsdc: number; dailyCapUsdc: number; slippageBps: number };
  watches: WatchRow[];
  policies: PolicyRow[];
}

export function PoliciesView() {
  const { identityToken } = useIdentityToken();
  const [busy, setBusy] = useState(false);

  const act = useCallback(
    async (body: Record<string, unknown>, reload: () => Promise<void>) => {
      if (!identityToken) return;
      setBusy(true);
      try {
        await fetch("/api/policies", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${identityToken}` },
          body: JSON.stringify(body),
        });
        await reload();
      } finally {
        setBusy(false);
      }
    },
    [identityToken],
  );

  return (
    <AuthedPanel<PoliciesData>
      endpoint="/api/policies"
      emptyTitle="No Parity account yet"
      emptyBody={
        <p>
          Send <code className="text-ink">/login</code> to the Parity bot in Telegram to get
          started.
        </p>
      }
    >
      {(data, reload) => (
        <div className="rise">
          {/*
            The kill switch sits above everything else, because the moment
            someone wants it they want it immediately and should not have to
            scroll past their positions to find it.
          */}
          <section className="border-hairline flex flex-wrap items-center justify-between gap-4 border-b pb-6">
            <div>
              <p className="text-ink text-sm font-medium">
                Automated execution is {data.paused ? "paused" : "active"}
              </p>
              <p className="text-ink-dim mt-1 max-w-prose text-xs leading-relaxed">
                {data.paused
                  ? "Your policies are kept but nothing will execute until you resume."
                  : "Armed policies can execute without asking, inside your limits."}
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act({ action: data.paused ? "resume" : "pause" }, reload)}
              className={`inline-flex min-h-10 items-center rounded-sm border px-4 text-xs transition-colors duration-100 active:translate-y-px disabled:opacity-50 ${
                data.paused
                  ? "border-hairline-strong text-ink hover:border-accent hover:text-accent"
                  : "border-premium/50 text-premium hover:border-premium"
              }`}
            >
              {data.paused ? "Resume execution" : "Pause everything"}
            </button>
          </section>

          {data.limits && (
            <section className="border-hairline flex flex-wrap gap-x-10 gap-y-4 border-b py-5">
              <Limit label="Max per trade" value={usd(data.limits.maxTradeUsdc)} />
              <Limit label="Max per day" value={usd(data.limits.dailyCapUsdc)} />
              <Limit label="Max slippage" value={`${(data.limits.slippageBps / 100).toFixed(2)}%`} />
            </section>
          )}

          <section className="border-hairline border-b py-8" aria-labelledby="policies-heading">
            <h2 id="policies-heading" className="text-ink mb-1 text-sm font-medium">
              Automation
            </h2>
            <p className="text-ink-faint mb-5 text-xs">Executes without confirmation, within your caps.</p>

            {data.policies.length === 0 ? (
              <p className="text-ink-dim max-w-prose text-xs leading-relaxed">
                Nothing armed. In Telegram, <code className="text-ink">/autobuy SPACEX 15 50</code>{" "}
                buys $50 automatically the moment SpaceX trades 15% below what it&rsquo;s backed by.
              </p>
            ) : (
              <ul>
                {data.policies.map((policy) => (
                  <li
                    key={policy.id}
                    className="border-hairline flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
                  >
                    <span className="tnum text-ink-faint w-8 text-xs">#{policy.id}</span>
                    <span className="tnum text-ink w-24 text-sm">{policy.symbol}</span>
                    <span className="text-ink-dim text-xs">
                      {policy.kind === "autobuy"
                        ? `Buy ${usd(policy.amountUsdc ?? 0)} at ${policy.thresholdPct}% below NAV`
                        : `Sell ${policy.amountToken == null ? "everything" : policy.amountToken} at ${policy.thresholdPct}% above NAV`}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act({ action: "cancelPolicy", id: policy.id }, reload)}
                      className="text-ink-faint hover:text-premium ml-auto min-h-10 text-xs transition-colors duration-100 disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="py-8" aria-labelledby="watches-heading">
            <h2 id="watches-heading" className="text-ink mb-1 text-sm font-medium">
              Alerts
            </h2>
            <p className="text-ink-faint mb-5 text-xs">Messages only — these never spend anything.</p>

            {data.watches.length === 0 ? (
              <p className="text-ink-dim max-w-prose text-xs leading-relaxed">
                No alerts set. Try <code className="text-ink">/watch SPACEX discount 15</code> in
                Telegram.
              </p>
            ) : (
              <ul>
                {data.watches.map((watch) => (
                  <li
                    key={watch.id}
                    className="border-hairline flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b py-3 last:border-b-0"
                  >
                    <span className="tnum text-ink w-24 text-sm">{watch.symbol}</span>
                    <span className="text-ink-dim text-xs">
                      {watch.thresholdPct}% {watch.direction}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void act({ action: "cancelWatch", symbol: watch.symbol }, reload)}
                      className="text-ink-faint hover:text-premium ml-auto min-h-10 text-xs transition-colors duration-100 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </AuthedPanel>
  );
}

function Limit({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <ColumnLabel>{label}</ColumnLabel>
      <p className="tnum text-ink mt-1 text-sm">{value}</p>
    </div>
  );
}
