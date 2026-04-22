-- CreateTable
CREATE TABLE "RoomPreviewSession" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mobileConnected" BOOLEAN NOT NULL DEFAULT false,
    "selectedRoom" JSONB,
    "selectedProduct" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomPreviewSession_pkey" PRIMARY KEY ("id")
);
