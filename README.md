# Parity

**Every PreStock has two prices. Almost nobody is looking at the gap.**

A [PreStock](https://prestocks.com) is a Solana token backed 1:1 by an SPV holding a real private
company — SpaceX, OpenAI, Anthropic, Anduril. That backing has a value (the **NAV**, published as
`markPrice`). The token also has a market price, set by whoever is trading it today
(`tokenPrice`). Those two numbers are not the same.

Parity computes that gap across every listed company, alerts you when it crosses a threshold you
set, and can execute the trade for you — inside limits you agreed to, with a kill switch.

At the time of writing, SpaceX trades **~20% below** what it is backed by and Neuralink trades
**~7.5% above**. That is the product.

> Not financial advice. A discount to fair value does not guarantee a profit — a private company's
> token can trade below its backing indefinitely. This is not arbitrage: there is no second
> exchange to close the gap against.

---

## Two surfaces, one backend

- **Telegram bot** — where you live day to day. Alerts, manual trades with an in-chat
  preview/confirm, automated buy and sell policies, portfolio, kill switch.
- **Web dashboard** — the one-time onboarding (log in, get a wallet, fund it, set your limits,
  authorize the signer), plus the public markets table, per-token NAV history, portfolio and
  automation management.

Both run from the same Next.js app. The bot is a webhook route handler, so there is no second
process and no second copy of the trading logic.

---

## What we verified before building

The four gates in the spec, all checked against production systems rather than documentation:

| Gate | Result |
|---|---|
| PreStocks API live and shaped as expected | Yes — 8 tokens, verified field-by-field |
| Jupiter routes every PreStocks mint | Yes, both directions, ~0–2% impact on $10 |
| Privy supports **Solana** server-signing | Yes — `privy.wallets().solana().signAndSendTransaction()` |
| Privy policies are granular enough | Partly — see *Guardrails* below |

### Three findings that change the math

These are properties of the actual mints, read from Solana mainnet. Each one is a silent money bug
if you miss it:

1. **Scaled UI Amount extension.** PreStocks are Token-2022 mints carrying a multiplier between
   raw on-chain units and the amount a human sees. SPACEX's is currently **5**; OPENAI's is
   **1.486**; ANDURIL and ANTHROPIC have none. The naive `raw / 10^decimals` every SPL tutorial
   uses would report a SPACEX position **five times too small**. The multiplier also has a
   scheduled successor with an activation timestamp, so "which multiplier is live" is a function
   of the current time. Parity reads it from the chain per mint and caches it
   (`lib/solana/mint.ts`).
2. **Transfer fee.** The mints withhold a fee (0.5% at time of writing) on every transfer, so a
   sale does not return the full notional.
3. **Permanent delegate and pausable.** The issuer can move tokens out of any account and can halt
   transfers entirely. Parity refuses to quote a paused mint, and says both of these plainly on
   the landing page rather than hiding them.

### One correction to the spec

Jupiter's v6 API (`quote-api.jup.ag/v6`) **no longer answers**. The live free endpoint is
`https://lite-api.jup.ag/swap/v1`, which is what Parity uses.

---

## Guardrails

The spec's rule is that guardrails are enforced server-side, not just in the UI. There is exactly
one path to spending money — `executeSwap` in `lib/privy/execute.ts` — and every caller goes
through it.

**On Privy's side** (holds even if Parity's code is wrong):
- the signer may only invoke allowlisted programs, so a stolen key cannot drain a wallet with a
  plain transfer
- token transfers are capped per transaction

**On Parity's side** (things Privy structurally cannot express — it evaluates one request at a
time and has no rolling window):
- **daily cap** across a rolling 24 hours, counting pending trades as well as confirmed ones, so a
  burst of triggers cannot outrun the limit before any settle
- **per-trade cap**, checked against the *quoted* size rather than the requested one
- **price-impact ceiling** derived from the quote about to be signed
- **balance check** against the live chain
- **kill switch** — `paused` halts all automated execution immediately, and is checked *before* a
  rule is claimed so a paused user's policies stay armed rather than being silently consumed

Every attempt writes a `Trade` row before the signer is called and updates it after. A row with
status `pending` and no signature is a real, visible outcome.

### Dry run is the default

`DRY_RUN=true` ships as the default. Every path runs for real — quote, transaction build, policy
checks, database writes — except the final handoff to Privy's signer. Flip one environment
variable for the live demo swap. Dry-run trades are recorded as such and never counted against
spend.

---

## The trigger engine

`lib/triggers/engine.ts`. One tick: pull live prices, persist them, walk every armed rule.

**It fires on the crossing, not on the condition.** `AlertState.currentlyTriggered` latches a rule
after it fires, and it only re-arms once the gap has retreated past a 3-point hysteresis band. A
token oscillating around −15% against a −15% rule alerts **once**, not once per tick.

**It cannot double-spend.** The check-and-set is a single conditional `UPDATE ... WHERE
currentlyTriggered = false`, so of two overlapping ticks exactly one is granted permission to
trade. A lease-based advisory lock stops concurrent ticks entirely, and expires so a crashed
process cannot wedge the poller.

Messages are delivered *after* the tick commits, so a Telegram outage can never roll back a trade
that actually happened.

---

## Resilience

The PreStocks API rate-limits aggressively, answering with a plain-text `Too Many Requests` body
rather than JSON. With the poller running and several people watching the dashboard, the naive
"fetch per reader" approach trips that limit and takes the product down exactly when people are
looking. Parity layers three defences (`lib/prestocks/feed.ts`):

1. one shared in-process cache, with concurrent misses deduplicated into a single in-flight request
2. last-good data served on a failed refresh — and the UI *says* the prices are stale rather than
   presenting old numbers as current
3. the `LatestPrice` rows the poller writes, as a final fallback that survives a full upstream
   outage

`npm run verify:outage` proves the third layer by stubbing the network to fail.

---

## Running it

```bash
npm install
cp .env.example .env          # fill in the values below
npm run db:up                 # local Postgres in Docker
npm run db:migrate            # create the schema
npm run dev
```

The public dashboard works immediately with no credentials — it reads the live PreStocks feed.
Accounts, alerts, automation and trading need the rest.

### Environment

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | accounts, alerts, history | `npm run db:up` gives you one |
| `PRIVY_APP_ID` / `PRIVY_APP_SECRET` | wallets | from the Privy dashboard |
| `PRIVY_AUTHORIZATION_KEY` | server signing | base64 PKCS8 P-256 key (below) |
| `NEXT_PUBLIC_PRIVY_SIGNER_ID` | onboarding | the key's id in the Privy dashboard |
| `TELEGRAM_BOT_TOKEN` | the bot | from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | the bot | any random string; Telegram echoes it back |
| `HELIUS_API_KEY` | balances, execution | free tier is fine |
| `CRON_SECRET` | the poller | required in production |
| `DRY_RUN` | safety | `true` by default; `false` executes real swaps |

### Generating the server signer key

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private.pem
openssl ec -in private.pem -pubout -out public.pem
# register public.pem in the Privy dashboard, then:
openssl pkcs8 -topk8 -nocrypt -in private.pem -outform DER | base64 | tr -d '\n'
# ^ that value is PRIVY_AUTHORIZATION_KEY
```

### Connecting the bot

```bash
npm run bot:setup -- https://your-deployed-url.example.com
```

Registers the webhook with the secret token and publishes the command list. Telegram cannot reach
`localhost`, so use a deployed URL or an `ngrok` tunnel.

### Running the poller

Vercel Cron is configured in `vercel.json` at one-minute granularity. For sub-minute ticks, run
the standalone worker anywhere always-on — it calls the identical service layer:

```bash
npm run poll -- 30    # every 30 seconds
```

### Verifying

```bash
npm run verify:creds    # proves every configured credential actually works
npm run verify          # 39 checks: math, hysteresis, scaled amounts, live routing, engine
npm run verify:mints    # reads all 8 mints from chain, cross-checks amount conversion
npm run verify:outage   # proves the feed survives a total PreStocks outage
```

`verify:mints` is the one that catches a missed multiplier: it converts a Jupiter quote using the
multiplier read from chain and checks the resulting dollar value against what the swap is actually
worth. A wrong multiplier shows up immediately as a 5x discrepancy.

`npm run verify` hits the real PreStocks API and real Jupiter, and drives the real trigger engine
against a temporary user — including proving that an armed watch fires exactly once and that a
paused user's auto-buy does not execute.

---

## Commands

**Market** — `/list` `/price <SYM>`
**Account** — `/login` `/balance` `/portfolio`
**Alerts** — `/watch <SYM> <discount|premium> <pct>` `/unwatch <SYM>` `/alerts`
**Trading** — `/buy <SYM> <usdc>` `/sell <SYM> <amount|all>`
**Automation** — `/autobuy <SYM> <pct> <usdc>` `/autosell <SYM> <pct> <amount|all>` `/policies`
`/cancelpolicy <id>`
**Safety** — `/pause` `/resume`

Manual trades show an in-chat preview with Confirm/Cancel. The pending trade is held server-side
and keyed by a random id, so the callback is an opaque handle rather than an instruction — a user
cannot edit the amount by crafting a callback, and pressing Confirm twice finds the row already
claimed and reports an expired preview instead of trading twice.

Automated trades execute without a preview — they were pre-authorized at onboarding, within caps —
and the bot confirms afterwards with a Solscan link.

---

## Layout

```
app/
  page.tsx              public markets table
  t/[symbol]/           per-token detail + NAV history chart
  onboard/              Privy login -> wallet -> fund -> limits -> authorize
  portfolio/  policies/ authed dashboard
  api/
    telegram/webhook/   grammY webhook
    cron/poll/          trigger engine tick
    tokens/ history/    public feeds
    onboard/ portfolio/ policies/
bot/
  bot.ts                assembly + outbox delivery
  commands/             market, account, trading, automation
  messages/format.ts    every user-facing string
lib/
  prestocks/            API client, feed layering, and the core math
  jupiter/              quote + swap builders
  solana/               RPC, mint introspection, balances
  privy/                server client, session verification, executeSwap
  triggers/engine.ts    crossing detection, hysteresis, execution
  db/                   Prisma client + repositories
prisma/schema.prisma
scripts/                verify, outage test, bot setup, standalone poller
```

The core math lives in exactly one place — `lib/prestocks/math.ts` — and the dashboard, the bot and
the trigger engine all read from it.

---

Built for the [Stocklana](https://hackathons.solana.com/hackathons/stocklana) hackathon,
**Best Use of PreStocks**.
