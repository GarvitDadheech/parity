import { Connection } from "@solana/web3.js";
import { config } from "@/lib/config";

/** Mainnet-beta genesis hash, in the CAIP-2 form Privy's signer expects. */
export const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" as const;

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;
export const USDC_DECIMALS = 6;

export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as const;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as const;

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl(), { commitment: "confirmed" });
  }
  return connection;
}

export function solscanTx(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function solscanToken(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

export function solscanAccount(address: string): string {
  return `https://solscan.io/account/${address}`;
}
