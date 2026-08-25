// /admin/chatbot - Chatbot administration inside the existing 3d admin dashboard.
// English / LTR, reusing the admin header, Fluent UI, and Tailwind card styling.
// Server-guarded: unauthenticated visitors are redirected to the admin login
// (every /api/admin/chatbot/* route independently re-checks the admin session).
import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/admin/require-admin";
import { AdminHeader } from "../_components/admin-header";
import ChatbotAdmin from "./_components/ChatbotAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Chatbot - Ibdaa 360 Admin" };

export default async function ChatbotAdminPage() {
  if (!(await hasAdminSession())) redirect("/admin/login");

  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <AdminHeader />
      <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Chatbot</h1>
          <p className="mt-1 text-sm text-slate-500">
            Manage the seller inventory chatbot - sellers, showrooms, inventory imports, and activity.
          </p>
        </div>
        <ChatbotAdmin />
      </main>
    </div>
  );
}
