-- Phase 1: Seller authentication (ADDITIVE ONLY).
-- Creates the SellerStatus enum, Showroom and Seller tables, their indexes, and
-- the Seller→Showroom foreign key. Does NOT alter or drop any existing table.

-- CreateEnum
CREATE TYPE "public"."SellerStatus" AS ENUM ('active', 'disabled');

-- CreateTable
CREATE TABLE "public"."Showroom" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Showroom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Seller" (
    "id" TEXT NOT NULL,
    "sellerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "public"."SellerStatus" NOT NULL DEFAULT 'disabled',
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "showroomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Seller_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Showroom_code_key" ON "public"."Showroom"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Seller_sellerCode_key" ON "public"."Seller"("sellerCode");

-- CreateIndex
CREATE INDEX "Seller_showroomId_idx" ON "public"."Seller"("showroomId");

-- CreateIndex
CREATE INDEX "Seller_status_idx" ON "public"."Seller"("status");

-- AddForeignKey
ALTER TABLE "public"."Seller" ADD CONSTRAINT "Seller_showroomId_fkey" FOREIGN KEY ("showroomId") REFERENCES "public"."Showroom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
