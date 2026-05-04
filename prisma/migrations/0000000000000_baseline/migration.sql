-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "public"."Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "dialCode" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CustomerExperience" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "roomImageUrl" TEXT,
    "roomImageKey" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "resultImageUrl" TEXT,
    "resultImageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "userSessionId" TEXT NOT NULL,
    "sessionId" TEXT,
    "eventType" TEXT NOT NULL,
    "renderJobId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RenderJob" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "failureReason" TEXT,
    "inputHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RoomPreviewSession" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mobileConnected" BOOLEAN NOT NULL DEFAULT false,
    "renderCount" INTEGER NOT NULL DEFAULT 0,
    "selectedRoom" JSONB,
    "selectedProduct" JSONB,
    "renderResult" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "screenId" TEXT,
    "lastRenderHash" TEXT,
    "userSessionId" TEXT,
    "customerId" TEXT,

    CONSTRAINT "RoomPreviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Screen" (
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

-- CreateTable
CREATE TABLE "public"."UserSession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT,
    "employeeCode" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "countryCode" TEXT,
    "dialCode" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_events" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'info',
    "statusBefore" TEXT,
    "statusAfter" TEXT,
    "code" TEXT,
    "message" TEXT,
    "metadata" JSONB,

    CONSTRAINT "session_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."session_issues" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "issueType" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "userVisible" BOOLEAN NOT NULL DEFAULT false,
    "customerMessageKey" TEXT,
    "adminMessage" TEXT NOT NULL,
    "recommendedAction" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,
    "metadata" JSONB,

    CONSTRAINT "session_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_expiresAt_idx" ON "public"."Customer"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "Customer_phoneE164_idx" ON "public"."Customer"("phoneE164" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneE164_key" ON "public"."Customer"("phoneE164" ASC);

-- CreateIndex
CREATE INDEX "CustomerExperience_createdAt_idx" ON "public"."CustomerExperience"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "CustomerExperience_customerId_idx" ON "public"."CustomerExperience"("customerId" ASC);

-- CreateIndex
CREATE INDEX "CustomerExperience_expiresAt_idx" ON "public"."CustomerExperience"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "Event_createdAt_idx" ON "public"."Event"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Event_eventType_idx" ON "public"."Event"("eventType" ASC);

-- CreateIndex
CREATE INDEX "Event_sessionId_idx" ON "public"."Event"("sessionId" ASC);

-- CreateIndex
CREATE INDEX "Event_userSessionId_idx" ON "public"."Event"("userSessionId" ASC);

-- CreateIndex
CREATE INDEX "RenderJob_sessionId_createdAt_idx" ON "public"."RenderJob"("sessionId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_customerId_idx" ON "public"."RoomPreviewSession"("customerId" ASC);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_expiresAt_idx" ON "public"."RoomPreviewSession"("expiresAt" ASC);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_screenId_idx" ON "public"."RoomPreviewSession"("screenId" ASC);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_status_idx" ON "public"."RoomPreviewSession"("status" ASC);

-- CreateIndex
CREATE INDEX "RoomPreviewSession_userSessionId_idx" ON "public"."RoomPreviewSession"("userSessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "RoomPreviewSession_userSessionId_key" ON "public"."RoomPreviewSession"("userSessionId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Screen_secretHash_key" ON "public"."Screen"("secretHash" ASC);

-- CreateIndex
CREATE INDEX "UserSession_createdAt_idx" ON "public"."UserSession"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "UserSession_role_idx" ON "public"."UserSession"("role" ASC);

-- CreateIndex
CREATE INDEX "session_events_eventType_idx" ON "public"."session_events"("eventType" ASC);

-- CreateIndex
CREATE INDEX "session_events_level_idx" ON "public"."session_events"("level" ASC);

-- CreateIndex
CREATE INDEX "session_events_sessionId_timestamp_idx" ON "public"."session_events"("sessionId" ASC, "timestamp" ASC);

-- CreateIndex
CREATE INDEX "session_events_source_idx" ON "public"."session_events"("source" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "session_issues_dedupeKey_key" ON "public"."session_issues"("dedupeKey" ASC);

-- CreateIndex
CREATE INDEX "session_issues_issueType_idx" ON "public"."session_issues"("issueType" ASC);

-- CreateIndex
CREATE INDEX "session_issues_lastSeenAt_idx" ON "public"."session_issues"("lastSeenAt" ASC);

-- CreateIndex
CREATE INDEX "session_issues_sessionId_status_idx" ON "public"."session_issues"("sessionId" ASC, "status" ASC);

-- CreateIndex
CREATE INDEX "session_issues_severity_idx" ON "public"."session_issues"("severity" ASC);

-- AddForeignKey
ALTER TABLE "public"."CustomerExperience" ADD CONSTRAINT "CustomerExperience_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "public"."UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RenderJob" ADD CONSTRAINT "RenderJob_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomPreviewSession" ADD CONSTRAINT "RoomPreviewSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomPreviewSession" ADD CONSTRAINT "RoomPreviewSession_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "public"."Screen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RoomPreviewSession" ADD CONSTRAINT "RoomPreviewSession_userSessionId_fkey" FOREIGN KEY ("userSessionId") REFERENCES "public"."UserSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_events" ADD CONSTRAINT "session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."session_issues" ADD CONSTRAINT "session_issues_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "public"."RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
