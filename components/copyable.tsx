"use client";

import { useState } from "react";

import { shortAddress } from "@/lib/format";

/**
 * A truncated address that can be recovered.
 *
 * Truncation is for scanning; the full value has to stay reachable, so clicking
 * copies the whole address and the button says so for a moment before reverting.
 */
export function CopyableAddress({
  address,
  chars = 4,
  className = "",
}: {
  address: string;
  chars?: number;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable over plain http or with permissions denied.
      // Selecting the text is the fallback, so failing silently is acceptable here.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={address}
      aria-label={copied ? "Address copied" : `Copy address ${address}`}
      className={`tnum text-ink-dim hover:text-ink inline-flex min-h-10 items-center gap-2 text-xs transition-colors duration-100 ${className}`}
    >
      <span>{shortAddress(address, chars, chars)}</span>
      <span className={copied ? "text-discount" : "text-ink-faint"}>
        {copied ? "copied" : "copy"}
      </span>
    </button>
  );
}
