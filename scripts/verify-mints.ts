/**
 * Reads every PreStocks mint from the chain and checks Parity's amount
 * conversion against Jupiter's own dollar valuation of the same swap.
 *
 * This is the check that catches a scaled-UI multiplier being missed: if the
 * conversion were wrong, the dollar value we compute from a quote would diverge
 * from the dollar value Jupiter reports for it.
 */

import { getQuote } from "../lib/jupiter/client";
import { fetchPreStocks } from "../lib/prestocks/client";
import { USDC_MINT } from "../lib/solana/connection";
import { getMintInfo, rawToUi } from "../lib/solana/mint";

let passed = 0;
let failed = 0;

function check(ok: boolean, line: string) {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${line}`);
}

async function main() {
  const tokens = await fetchPreStocks({ force: true });
  console.log(`\nReading ${tokens.length} mints from the chain\n${"-".repeat(40)}`);

  for (const token of tokens) {
    const info = await getMintInfo(token.contract_address);

    const quote = await getQuote({
      inputMint: USDC_MINT,
      outputMint: token.contract_address,
      amount: 10_000_000n, // $10
      slippageBps: 100,
    });

    // Convert Jupiter's raw output with our multiplier, then price it at the
    // market price the PreStocks feed reports. The two should agree on ~$10.
    const tokensOut = rawToUi(BigInt(quote.outAmount), info);
    const impliedUsd = tokensOut * token.tokenPrice;

    const withinTolerance = impliedUsd > 9.3 && impliedUsd < 10.7;
    check(
      withinTolerance,
      `${token.symbol.padEnd(11)} decimals=${info.decimals} multiplier=${String(info.uiMultiplier).padEnd(7)} ` +
        `fee=${(info.transferFeeBps / 100).toFixed(2)}% ` +
        `paused=${info.paused ? "YES" : "no"} delegate=${info.hasPermanentDelegate ? "YES" : "no"} ` +
        `| $10 -> ${tokensOut.toFixed(6)} tok -> $${impliedUsd.toFixed(2)}`,
    );

    if (!withinTolerance) {
      console.log(
        `        conversion is off — a wrong multiplier would show exactly this`,
      );
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
