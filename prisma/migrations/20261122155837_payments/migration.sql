-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMING', 'PAID', 'UNDERPAID', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PAYPAL', 'CRYPTO');

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "reference" SERIAL NOT NULL,
    "secretHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "purpose" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL DEFAULT '',
    "notes" TEXT NOT NULL DEFAULT '',
    "fiatAmount" DECIMAL(12,2) NOT NULL,
    "fiatCurrency" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod",
    "network" TEXT,
    "asset" TEXT,
    "expectedRaw" TEXT,
    "expectedAmount" TEXT,
    "quotePrice" TEXT,
    "quoteExpiresAt" TIMESTAMPTZ(6),
    "payToAddress" TEXT,
    "txHash" TEXT,
    "submittedAt" TIMESTAMPTZ(6),
    "payerWallet" TEXT,
    "receivedRaw" TEXT,
    "confirmations" INTEGER,
    "paypalOrderId" TEXT,
    "paypalCaptureId" TEXT,
    "paypalPayerEmail" TEXT,
    "failureReason" TEXT NOT NULL DEFAULT '',
    "lastCheckedAt" TIMESTAMPTZ(6),
    "paidAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_paypalOrderId_key" ON "Payment"("paypalOrderId");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_email_idx" ON "Payment"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_network_txHash_key" ON "Payment"("network", "txHash");
