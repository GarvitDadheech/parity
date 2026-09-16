/** One element of the array returned by GET https://prestocks.com/api/prestocks. */
export interface PreStockRaw {
  name: string;
  symbol: string;
  description: string;
  image: string;
  external_url: string;
  /** Solana SPL / Token-2022 mint address. */
  contract_address: string;
  /** Backed fair value per token, from the 1:1 SPV. This is "NAV". */
  markPrice: number;
  markValuation: number;
  /** Live on-chain trading price per token. */
  tokenPrice: number;
  impliedValuation: number;
  supply: number;
}

export type Verdict =
  | "DEEP_DISCOUNT"
  | "DISCOUNT"
  | "FAIR"
  | "PREMIUM"
  | "HIGH_PREMIUM";

/** A PreStock with Parity's derived numbers attached. */
export interface PreStock extends PreStockRaw {
  /** (tokenPrice - markPrice) / markPrice * 100. Negative is a discount. */
  premiumPct: number;
  verdict: Verdict;
}
