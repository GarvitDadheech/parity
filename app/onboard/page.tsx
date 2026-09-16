import { OnboardFlow } from "@/components/onboard-flow";
import { Privy } from "@/components/privy-provider";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Set up your wallet — Parity",
};

export default async function OnboardPage(props: PageProps<"/onboard">) {
  const params = await props.searchParams;
  const raw = params.t;
  const onboardToken = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-14 md:px-8">
      <header className="mb-10">
        <p className="text-accent mb-4 text-[10px] tracking-[0.14em] uppercase">Setup · one time</p>
        <h1 className="text-ink text-2xl font-medium tracking-tight">
          Connect a wallet to Parity
        </h1>
        <p className="text-ink-dim mt-4 max-w-prose text-sm leading-relaxed">
          Three steps. At the end, Parity will be able to execute the trades you&rsquo;ve armed —
          within limits you set on this page — without asking you to sign each one. Everything
          after this happens in Telegram.
        </p>
      </header>

      <Privy>
        <OnboardFlow onboardToken={onboardToken} />
      </Privy>
    </div>
  );
}
