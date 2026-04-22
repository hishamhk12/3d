-- AlterTable
ALTER TABLE "RenderJob" ADD COLUMN     "inputHash" TEXT;

-- AlterTable
ALTER TABLE "RoomPreviewSession" ADD COLUMN     "lastRenderHash" TEXT,
ADD COLUMN     "screenId" TEXT;

-- CreateTable
CREATE TABLE "Screen" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "secretHash" TEXT NOT NULL,
    "dailyBudget" INTEGER NOT NULL DEFAULT 15,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRenderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Screen_secretHash_key" ON "Screen"("secretHash");

-- CreateIndex
CREATE INDEX "RoomPreviewSession_screenId_idx" ON "RoomPreviewSession"("screenId");

-- AddForeignKey
ALTER TABLE "RoomPreviewSession" ADD CONSTRAINT "RoomPreviewSession_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE SET NULL ON UPDATE CASCADE;
