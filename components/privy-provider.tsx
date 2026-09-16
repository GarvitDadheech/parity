"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { toSolanaWalletConnectors } from "@privy-io/react-auth/solana";

/**
 * Privy, configured for Solana only.
 *
 * Parity has no use for an EVM wallet, and creating one anyway would leave users
 * with an empty address they have to reason about. Login is Telegram-first with
 * email as the fallback, which matches where the product actually lives.
 */
export function Privy({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div className="border-hairline rounded-sm border px-5 py-10 text-center">
        <p className="text-ink text-sm">Wallet onboarding isn&rsquo;t configured.</p>
        <p className="text-ink-dim mx-auto mt-2 max-w-prose text-xs leading-relaxed">
          Set <code className="text-ink">NEXT_PUBLIC_PRIVY_APP_ID</code> in the environment and
          reload. Everything else on Parity works without it.
        </p>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["telegram", "email"],
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          ethereum: { createOnLogin: "off" },
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        appearance: {
          theme: "dark",
          accentColor: "#e0a43c",
          logo: undefined,
          walletChainType: "solana-only",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
