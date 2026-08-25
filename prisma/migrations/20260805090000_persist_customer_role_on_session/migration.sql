-- Keep current session state on RoomPreviewSession itself. The session_events
-- table is an audit log and may be unavailable on legacy deployments whose
-- migration history predates the diagnostics baseline.
ALTER TABLE "RoomPreviewSession"
ADD COLUMN IF NOT EXISTS "customerRoleSelected" BOOLEAN NOT NULL DEFAULT false;

-- Preserve the state of existing customer sessions when the audit table is
-- present. The conditional block also makes this repair safe on legacy schemas
-- where session_events was never deployed.
DO $$
BEGIN
  IF to_regclass('public.session_events') IS NOT NULL THEN
    UPDATE "RoomPreviewSession" AS session
    SET "customerRoleSelected" = true
    WHERE EXISTS (
      SELECT 1
      FROM "session_events" AS event
      WHERE event."sessionId" = session."id"
        AND event."eventType" = 'gate_customer_role_selected'
    );
  END IF;
END $$;
