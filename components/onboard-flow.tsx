"use client";

import { useIdentityToken, usePrivy, useSigners } from "@privy-io/react-auth";
import { useCreateWallet, useWallets } from "@privy-io/react-auth/solana";
import { useCallback, useEffect, useState } from "react";

import { CopyableAddress } from "@/components/copyable";
import { usd } from "@/lib/format";

type StepState = "todo" | "active" | "done";

interface LinkStatus {
  valid: boolean;
  alreadyConnected?: boolean;
  walletAddress?: string | null;
  limits?: { maxTradeUsdc: number; dailyCapUsdc: number; slippageBps: number };
}

/**
 * One-time onboarding: log in, get a Solana wallet, fund it, grant the server
 * signer, set limits.
 *
 * The limits step is deliberately the last thing before granting, not a
 * afterthought in settings — the numbers a user picks here are the only thing
 * bounding what Parity can do on their behalf, so they are shown at the moment
 * they consent, not buried.
 */
export function OnboardFlow({ onboardToken }: { onboardToken: string | null }) {
  const { ready, authenticated, login, user } = usePrivy();
  const { identityToken } = useIdentityToken();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { addSigners } = useSigners();

  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [creating, setCreating] = useState(false);
  const [granting, setGranting] = useState(false);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [initTimedOut, setInitTimedOut] = useState(false);

  const [maxTradeUsdc, setMaxTradeUsdc] = useState(50);
  const [dailyCapUsdc, setDailyCapUsdc] = useState(200);
  const [slippagePct, setSlippagePct] = useState(1);

  const wallet = wallets[0];
  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

  /**
   * Privy fails silently when the page's origin is not on its allowlist: the
   * iframe handshake never completes, no error is raised, and `ready` simply
   * stays false. Left alone that renders as a spinner forever, which tells the
   * user nothing. After eight seconds we say what is most likely wrong instead.
   */
  useEffect(() => {
    if (ready) return;
    const timer = window.setTimeout(
      // Fires 8s later from a timer rather than during the effect, so it cannot
      // cause a cascading render. The flag is never reset: the alert it drives
      // is rendered only while `ready` is still false, so a late success hides
      // it without any extra state juggling.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      () => setInitTimedOut(true),
      8_000,
    );
    return () => window.clearTimeout(timer);
  }, [ready]);

  // Validate the link from the bot before asking anyone to log in — a stale link
  // should fail here, not after they have created a wallet.
  useEffect(() => {
    if (!onboardToken) return;
    void (async () => {
      try {
        const response = await fetch(`/api/onboard/status?t=${encodeURIComponent(onboardToken)}`);
        if (!response.ok) {
          setStatus({ valid: false });
          return;
        }
        const data: LinkStatus = await response.json();
        setStatus(data);
        if (data.limits) {
          setMaxTradeUsdc(data.limits.maxTradeUsdc);
          setDailyCapUsdc(data.limits.dailyCapUsdc);
          setSlippagePct(data.limits.slippageBps / 100);
        }
      } catch {
        setStatus({ valid: false });
      }
    })();
  }, [onboardToken]);

  const handleCreateWallet = useCallback(async () => {
    setCreating(true);
    setError(null);
    try {
      await createWallet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create a wallet");
    } finally {
      setCreating(false);
    }
  }, [createWallet]);

  /**
   * Grant the signer, then tell our backend.
   *
   * Order matters: the grant happens on Privy first, and only a successful grant
   * results in `signerActive` being set in our database. If the grant fails we
   * must not record a user as ready to trade.
   */
  const handleGrant = useCallback(async () => {
    if (!wallet || !onboardToken || !identityToken) return;

    setGranting(true);
    setError(null);

    try {
      if (!signerId) {
        throw new Error(
          "NEXT_PUBLIC_PRIVY_SIGNER_ID is not set. Register Parity's authorization public key in " +
            "the Privy dashboard and put its id in the environment.",
        );
      }

      await addSigners({ address: wallet.address, signers: [{ signerId }] });

      const response = await fetch("/api/onboard/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          onboardToken,
          identityToken,
          limits: {
            maxTradeUsdc,
            dailyCapUsdc,
            slippageBps: Math.round(slippagePct * 100),
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not link your wallet");

      setLinked(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not authorize the signer");
    } finally {
      setGranting(false);
    }
  }, [
    addSigners,
    dailyCapUsdc,
    identityToken,
    maxTradeUsdc,
    onboardToken,
    signerId,
    slippagePct,
    wallet,
  ]);

  if (!onboardToken) {
    return (
      <Notice title="Open this from Telegram">
        Send <code className="text-ink">/login</code> to the Parity bot and it will give you a
        personal setup link. This page needs that link to know which chat to connect.
      </Notice>
    );
  }

  if (status && !status.valid) {
    return (
      <Notice title="This link has expired">
        Send <code className="text-ink">/login</code> in Telegram again for a fresh one. Links are
        single-use so a shared one can&rsquo;t connect someone else&rsquo;s wallet to your chat.
      </Notice>
    );
  }

  if (linked) {
    return (
      <div className="rise">
        <h2 className="text-ink text-lg font-medium tracking-tight">You&rsquo;re set up.</h2>
        <p className="text-ink-dim mt-3 max-w-prose text-sm leading-relaxed">
          Parity can now execute trades from this wallet, up to {usd(maxTradeUsdc)} per trade and{" "}
          {usd(dailyCapUsdc)} per day. Head back to Telegram — try{" "}
          <code className="text-ink">/list</code> to see today&rsquo;s gaps, or{" "}
          <code className="text-ink">/autobuy SPACEX 15 50</code> to arm your first policy.
        </p>
        <p className="text-ink-faint mt-6 max-w-prose text-xs leading-relaxed">
          You can revoke this at any time with <code className="text-ink-dim">/pause</code> in the
          bot, or by removing the signer in your Privy account. Not financial advice.
        </p>
      </div>
    );
  }

  const loginState: StepState = authenticated ? "done" : "active";
  const walletState: StepState = !authenticated ? "todo" : wallet ? "done" : "active";
  const grantState: StepState = !wallet ? "todo" : "active";

  return (
    <div className="space-y-px">
      <Step n={1} title="Log in" state={loginState}>
        {authenticated ? (
          <p className="text-ink-dim text-xs">
            Signed in{user?.telegram?.username ? ` as @${user.telegram.username}` : ""}.
          </p>
        ) : (
          <>
            <p className="text-ink-dim mb-4 max-w-prose text-xs leading-relaxed">
              Telegram or email. Parity never sees a password or a private key — the wallet is
              created and held by Privy on your behalf.
            </p>
            <PrimaryButton onClick={login} disabled={!ready} loading={!ready}>
              {ready ? "Log in" : "Connecting\u2026"}
            </PrimaryButton>

            {initTimedOut && !ready && (
              <div role="alert" className="border-hairline-strong mt-5 max-w-prose rounded-sm border px-4 py-3">
                <p className="text-ink text-xs font-medium">Login isn&rsquo;t loading.</p>
                <p className="text-ink-dim mt-2 text-xs leading-relaxed">
                  This almost always means this site&rsquo;s address isn&rsquo;t on the wallet
                  provider&rsquo;s allowed-origins list, so its secure frame never finishes
                  connecting. Add{" "}
                  <code className="text-ink break-all">
                    {typeof window !== "undefined" ? window.location.origin : ""}
                  </code>{" "}
                  to the allowed origins in the Privy dashboard, then reload this page.
                </p>
              </div>
            )}
          </>
        )}
      </Step>

      <Step n={2} title="Your Solana wallet" state={walletState}>
        {wallet ? (
          <div className="space-y-4">
            <CopyableAddress address={wallet.address} chars={8} />
            <p className="text-ink-dim max-w-prose text-xs leading-relaxed">
              Send <span className="text-ink">USDC</span> here to trade with, plus a little{" "}
              <span className="text-ink">SOL</span> for network fees — about 0.02 SOL is plenty.
              The wallet is yours; Parity only ever gets permission to act within the limits below.
            </p>
          </div>
        ) : authenticated ? (
          <PrimaryButton onClick={handleCreateWallet} disabled={creating} loading={creating}>
            {creating ? "Creating…" : "Create wallet"}
          </PrimaryButton>
        ) : (
          <p className="text-ink-faint text-xs">Log in first.</p>
        )}
      </Step>

      <Step n={3} title="Set your limits and authorize" state={grantState}>
        <p className="text-ink-dim mb-6 max-w-prose text-xs leading-relaxed">
          These bound everything Parity can do without asking you again. They are enforced on the
          server on every single trade, not just in the interface.
        </p>

        <div className="grid gap-5 sm:grid-cols-3">
          <LimitField
            id="max-trade"
            label="Max per trade"
            prefix="$"
            value={maxTradeUsdc}
            min={1}
            max={10000}
            step={5}
            onChange={setMaxTradeUsdc}
            help="Largest single automated buy."
          />
          <LimitField
            id="daily-cap"
            label="Max per day"
            prefix="$"
            value={dailyCapUsdc}
            min={1}
            max={50000}
            step={25}
            onChange={setDailyCapUsdc}
            help="Rolling 24-hour total."
          />
          <LimitField
            id="slippage"
            label="Max slippage"
            suffix="%"
            value={slippagePct}
            min={0.1}
            max={5}
            step={0.1}
            onChange={setSlippagePct}
            help="Trades above this are refused."
          />
        </div>

        {dailyCapUsdc < maxTradeUsdc && (
          <p className="text-premium mt-4 text-xs">
            Your daily cap is below your per-trade cap, so only one trade could ever run. Raise the
            daily cap or lower the per-trade cap.
          </p>
        )}

        <div className="mt-8">
          <PrimaryButton
            onClick={handleGrant}
            disabled={!wallet || granting || !identityToken}
            loading={granting}
          >
            {granting ? "Authorizing…" : "Authorize Parity"}
          </PrimaryButton>
        </div>
      </Step>

      {error && (
        <div role="alert" className="border-premium/40 mt-6 rounded-sm border px-4 py-3">
          <p className="text-premium text-xs leading-relaxed">{error}</p>
        </div>
      )}
    </div>
  );
}

function Step({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`border-hairline border-t py-8 ${state === "todo" ? "opacity-40" : ""}`}
      aria-current={state === "active" ? "step" : undefined}
    >
      <div className="flex items-baseline gap-3">
        <span className={`tnum text-[10px] ${state === "done" ? "text-discount" : "text-accent"}`}>
          {state === "done" ? "✓" : String(n).padStart(2, "0")}
        </span>
        <h2 className="text-ink text-sm font-medium">{title}</h2>
      </div>
      <div className="mt-4 pl-6">{children}</div>
    </section>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  loading,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={loading}
      className="bg-accent text-canvas inline-flex min-h-10 items-center rounded-sm px-4 text-xs font-medium transition-opacity duration-100 hover:opacity-90 active:translate-y-px disabled:pointer-events-none disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function LimitField({
  id,
  label,
  value,
  onChange,
  min,
  max,
  step,
  prefix,
  suffix,
  help,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  help: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink-faint block text-[10px] tracking-[0.08em] uppercase">
        {label}
      </label>
      <div className="border-hairline-strong focus-within:border-accent mt-2 flex items-center gap-1 border-b pb-1 transition-colors duration-100">
        {prefix && <span className="text-ink-dim tnum text-sm">{prefix}</span>}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(Number(event.target.value))}
          className="tnum text-ink min-h-10 w-full bg-transparent text-sm outline-none"
        />
        {suffix && <span className="text-ink-dim tnum text-sm">{suffix}</span>}
      </div>
      <p className="text-ink-faint mt-2 text-[11px] leading-relaxed">{help}</p>
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline rounded-sm border px-5 py-10 text-center">
      <p className="text-ink text-sm">{title}</p>
      <p className="text-ink-dim mx-auto mt-2 max-w-prose text-xs leading-relaxed">{children}</p>
    </div>
  );
}
