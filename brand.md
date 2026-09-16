# Brand — Parity

_Status: active_

## The name

The product is **Parity**. Not "FairValue" — that name appears in the original build
specification and is superseded. Parity is the state the product is watching for: the moment a
token's market price meets the fair value it is backed by. Every gap the dashboard shows is a
distance from parity.

## Direction: stark monochrome terminal

Near-black canvas, one accent, hairline rules instead of cards, tabular monospace numerals.
Flat. No gradients, no drop shadows, no glass, no decorative chrome. The density and the
typography do the work; nothing is there to look designed.

The reference point is a financial terminal rather than a consumer crypto app — which is also
why the accent is amber. Amber on black is the oldest convention in market data, and it is the
one accent colour that cannot be confused with the green and red doing semantic work in the
numbers.

## Palette

| Token | Value | Use |
|---|---|---|
| `--color-canvas` | `#080809` | Page background |
| `--color-surface` | `#0E0E10` | Raised rows, inputs |
| `--color-hairline` | `#1C1C20` | Every rule and border. 1px, never 2. |
| `--color-ink` | `#EDEDEF` | Primary text |
| `--color-ink-dim` | `#8E8E96` | Secondary text. Passes AA on canvas. |
| `--color-ink-faint` | `#5A5A62` | Column labels, timestamps |
| `--color-accent` | `#E0A43C` | Brand, links, focus rings, primary actions |
| `--color-discount` | `#45B26B` | Trading below fair value — the opportunity |
| `--color-premium` | `#E0524A` | Trading above fair value — overpaying |

Green and red are reserved strictly for the direction of the NAV gap. They never appear as
decoration, and they are applied to the number itself rather than to a background, so a page of
positions does not read as a wall of colour.

## Typography

- **Geist Mono** for every number, symbol, address and column label. Always `tabular-nums`, so a
  figure that updates in place does not shift the column.
- **Geist Sans** for prose — descriptions, explanations, disclaimers.
- Display sizes stay small. A terminal earns authority from density, not from large headings.

## Voice

Plain, specific, and never promotional. The product's honesty is the pitch: a discount is called
a discount, not an arbitrage, because there is no second exchange to arbitrage against — these
are private companies. Copy states what is true and what is uncertain, including the risks that
are unflattering (issuer clawback, transfer fees, a discount that may simply persist).

Every surface that talks about money carries: _"Not financial advice. A discount to fair value
does not guarantee a profit."_
