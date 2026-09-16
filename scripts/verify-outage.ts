/**
 * Proves Parity survives a total PreStocks outage.
 *
 * Every network call is stubbed to fail before the feed module is loaded, so the
 * in-process cache is genuinely empty and the only thing that can answer is the
 * LatestPrice table the poller writes. This is the path every reader hits if the
 * upstream API rate-limits, so it is worth proving rather than assuming.
 */

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("prestocks.com")) {
    throw new Error("simulated outage: upstream unreachable");
  }
  return realFetch(input as RequestInfo);
}) as typeof fetch;

async function main() {
  const { loadFeed } = await import("../lib/prestocks/feed");

  try {
    const feed = await loadFeed();
    const ok = feed.source === "database" && feed.tokens.length > 0;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  feed survives a total upstream outage — ` +
        `source=${feed.source}, ${feed.tokens.length} tokens, ${feed.ageSeconds}s old`,
    );
    if (ok) {
      const widest = feed.tokens[0];
      console.log(
        `        still shows ${widest.symbol} at ${widest.premiumPct.toFixed(2)}% ` +
          `from stored prices`,
      );
    }
    process.exit(ok ? 0 : 1);
  } catch (error) {
    console.log(`  FAIL  feed threw during outage: ${error}`);
    process.exit(1);
  }
}

void main();
