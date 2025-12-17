-- CreateEnum
CREATE TYPE "Asset" AS ENUM ('BTCUSDT', 'ETHUSDT', 'SOLUSDT');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('LONG', 'SHORT');

-- CreateTable
CREATE TABLE "closed_orders" (
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" "Asset" NOT NULL,
    "orderType" "OrderType" NOT NULL,
    "leverage" INTEGER NOT NULL,
    "marginInt" BIGINT NOT NULL,
    "executionPoint" BIGINT NOT NULL,
    "closePriceInt" BIGINT NOT NULL,
    "qtyInt" BIGINT NOT NULL,
    "stopLossInt" BIGINT NOT NULL,
    "takeProfitInt" BIGINT NOT NULL,
    "finalPnLInt" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "closed_orders_pkey" PRIMARY KEY ("orderId")
);

-- CreateIndex
CREATE INDEX "closed_orders_userId_closedAt_idx" ON "closed_orders"("userId", "closedAt");

-- CreateIndex
CREATE INDEX "closed_orders_closedAt_idx" ON "closed_orders"("closedAt");

-- CreateIndex
CREATE INDEX "closed_orders_asset_idx" ON "closed_orders"("asset");
