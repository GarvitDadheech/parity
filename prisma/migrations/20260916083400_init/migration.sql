-- CreateTable
CREATE TABLE "User" (
    "telegramId" BIGINT NOT NULL,
    "privyUserId" TEXT,
    "walletId" TEXT,
    "walletAddr" TEXT,
    "signerActive" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "maxTradeUsdc" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "dailyCapUsdc" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "slippageBps" INTEGER NOT NULL DEFAULT 100,
    "onboardToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("telegramId")
);

-- CreateTable
CREATE TABLE "PriceSnapshot" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "markPrice" DOUBLE PRECISION NOT NULL,
    "tokenPrice" DOUBLE PRECISION NOT NULL,
    "premiumPct" DOUBLE PRECISION NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PriceSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LatestPrice" (
    "symbol" TEXT NOT NULL,
    "markPrice" DOUBLE PRECISION NOT NULL,
    "tokenPrice" DOUBLE PRECISION NOT NULL,
    "premiumPct" DOUBLE PRECISION NOT NULL,
    "mint" TEXT,
    "name" TEXT,
    "tradable" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LatestPrice_pkey" PRIMARY KEY ("symbol")
);

-- CreateTable
CREATE TABLE "Watch" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "symbol" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "thresholdPct" DOUBLE PRECISION NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Policy" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "thresholdPct" DOUBLE PRECISION NOT NULL,
    "amountUsdc" DOUBLE PRECISION,
    "amountToken" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertState" (
    "telegramId" BIGINT NOT NULL,
    "symbol" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "currentlyTriggered" BOOLEAN NOT NULL DEFAULT false,
    "lastFiredAt" TIMESTAMP(3),

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("telegramId","symbol","ruleKey")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" SERIAL NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "usdcAmount" DOUBLE PRECISION,
    "tokenAmount" DOUBLE PRECISION,
    "premiumAtExec" DOUBLE PRECISION NOT NULL,
    "txSig" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingTrade" (
    "id" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "mint" TEXT NOT NULL,
    "usdcAmount" DOUBLE PRECISION,
    "tokenAmount" DOUBLE PRECISION,
    "quotedPrice" DOUBLE PRECISION NOT NULL,
    "premiumPct" DOUBLE PRECISION NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLock" (
    "key" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemLock_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletId_key" ON "User"("walletId");

-- CreateIndex
CREATE UNIQUE INDEX "User_onboardToken_key" ON "User"("onboardToken");

-- CreateIndex
CREATE INDEX "PriceSnapshot_symbol_ts_idx" ON "PriceSnapshot"("symbol", "ts");

-- CreateIndex
CREATE INDEX "Watch_telegramId_idx" ON "Watch"("telegramId");

-- CreateIndex
CREATE INDEX "Watch_symbol_active_idx" ON "Watch"("symbol", "active");

-- CreateIndex
CREATE INDEX "Policy_telegramId_idx" ON "Policy"("telegramId");

-- CreateIndex
CREATE INDEX "Policy_symbol_active_idx" ON "Policy"("symbol", "active");

-- CreateIndex
CREATE INDEX "Trade_telegramId_idx" ON "Trade"("telegramId");

-- CreateIndex
CREATE INDEX "Trade_createdAt_idx" ON "Trade"("createdAt");

-- CreateIndex
CREATE INDEX "PendingTrade_telegramId_idx" ON "PendingTrade"("telegramId");

-- AddForeignKey
ALTER TABLE "Watch" ADD CONSTRAINT "Watch_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId") ON DELETE CASCADE ON UPDATE CASCADE;
