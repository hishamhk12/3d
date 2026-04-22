-- AlterTable
ALTER TABLE "RoomPreviewSession" ADD COLUMN     "renderResult" JSONB;

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RenderJob_sessionId_createdAt_idx" ON "RenderJob"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
