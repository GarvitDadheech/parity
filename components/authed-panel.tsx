"use client";

import { useIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";

/**
 * Shared shell for the two dashboard pages that need to know who you are.
 *
 * It handles the four states these pages share — loading, signed out, signed in
 * but never linked from Telegram, and ready — so neither page has to reimplement
 * them, and so "you haven't connected Telegram yet" reads as a next step rather
 * than an error.
 */
export function AuthedPanel<T extends { linked: boolean }>({
  endpoint,
  refreshMs,
  children,
  emptyTitle,
  emptyBody,
}: {
  endpoint: string;
  refreshMs?: number;
  emptyTitle: string;
  emptyBody: React.ReactNode;
  children: (data: T, reload: () => Promise<void>) => React.ReactNode;
}) {
  const { ready, authenticated, login } = usePrivy();
  const { identityToken } = useIdentityToken();

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!identityToken) return;
    setLoading(true);
    try {
      const response = await fetch(endpoint, {
        headers: { authorization: `Bearer ${identityToken}` },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
      setData(body as T);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [endpoint, identityToken]);

  useEffect(() => {
    if (!identityToken) return;

    // Deferred out of the effect body so the first paint is the skeleton rather
    // than a cascading re-render.
    const kickoff = window.setTimeout(() => void load(), 0);
    const timer = refreshMs ? window.setInterval(() => void load(), refreshMs) : undefined;

    return () => {
      window.clearTimeout(kickoff);
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [identityToken, load, refreshMs]);

  if (!ready) return <PanelSkeleton />;

  if (!authenticated) {
    return (
      <Empty title="Sign in to see this">
        <p>
          Use the same login you used when you set up your wallet. Everything here also works from
          the Telegram bot.
        </p>
        <button
          type="button"
          onClick={login}
          className="bg-accent text-canvas mt-5 inline-flex min-h-10 items-center rounded-sm px-4 text-xs font-medium transition-opacity duration-100 hover:opacity-90 active:translate-y-px"
        >
          Log in
        </button>
      </Empty>
    );
  }

  if (error) {
    return (
      <Empty title="Couldn't load this">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="border-hairline-strong text-ink hover:border-accent hover:text-accent mt-5 inline-flex min-h-10 items-center rounded-sm border px-4 text-xs transition-colors duration-100"
        >
          Try again
        </button>
      </Empty>
    );
  }

  if (!data || (loading && !data)) return <PanelSkeleton />;

  if (!data.linked) {
    return <Empty title={emptyTitle}>{emptyBody}</Empty>;
  }

  return <>{children(data, load)}</>;
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-hairline rounded-sm border px-5 py-12 text-center">
      <p className="text-ink text-sm">{title}</p>
      <div className="text-ink-dim mx-auto mt-3 max-w-prose space-y-2 text-xs leading-relaxed">
        {children}
      </div>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="space-y-px" aria-busy="true" aria-label="Loading">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="border-hairline border-t py-5">
          <span className="bg-hairline-strong mb-2 block h-3 w-24 rounded-sm" />
          <span className="bg-hairline block h-2.5 w-48 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
