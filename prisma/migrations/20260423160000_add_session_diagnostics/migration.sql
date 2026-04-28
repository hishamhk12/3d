-- CreateTable
CREATE TABLE "session_events" (
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
CREATE TABLE "session_issues" (
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
CREATE INDEX "session_events_sessionId_timestamp_idx" ON "session_events"("sessionId", "timestamp");

-- CreateIndex
CREATE INDEX "session_events_eventType_idx" ON "session_events"("eventType");

-- CreateIndex
CREATE INDEX "session_events_level_idx" ON "session_events"("level");

-- CreateIndex
CREATE INDEX "session_events_source_idx" ON "session_events"("source");

-- CreateIndex
CREATE UNIQUE INDEX "session_issues_dedupeKey_key" ON "session_issues"("dedupeKey");

-- CreateIndex
CREATE INDEX "session_issues_sessionId_status_idx" ON "session_issues"("sessionId", "status");

-- CreateIndex
CREATE INDEX "session_issues_issueType_idx" ON "session_issues"("issueType");

-- CreateIndex
CREATE INDEX "session_issues_severity_idx" ON "session_issues"("severity");

-- CreateIndex
CREATE INDEX "session_issues_lastSeenAt_idx" ON "session_issues"("lastSeenAt");

-- AddForeignKey
ALTER TABLE "session_events" ADD CONSTRAINT "session_events_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_issues" ADD CONSTRAINT "session_issues_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RoomPreviewSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
