import { redirect } from "next/navigation";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";

type ActivationPageProps = {
  params: Promise<{ sessionId: string }>;
};

/**
 * Fallback page for old QR codes that still point to /room-preview/activate/[sessionId].
 * The primary activation path is now the API route GET handler which handles
 * cookie-setting and redirect server-side.
 */
export default async function ActivationPage({ params }: ActivationPageProps) {
  const { sessionId } = await params;
  redirect(ROOM_PREVIEW_ROUTES.mobileSession(sessionId));
}
