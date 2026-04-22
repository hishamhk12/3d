-- AlterTable
ALTER TABLE "RoomPreviewSession" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_status_idx" ON "RoomPreviewSession"("status");

-- CreateIndex
CREATE INDEX "RoomPreviewSession_expiresAt_idx" ON "RoomPreviewSession"("expiresAt");
