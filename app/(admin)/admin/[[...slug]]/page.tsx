import { notFound } from "next/navigation";
import AdminHomePage from "../home-view";
import AnalyticsPage from "../analytics/view";
import ChatbotAdminPage from "../chatbot/view";
import AdminDiagnosticsPage from "../diagnostics/view";
import SessionDiagnosticsPage from "../diagnostics/[sessionId]/view";
import AdminLoginPage from "../login/view";
import RenderErrorsPage from "../render-errors/view";

export const dynamic = "force-dynamic";

type AdminCatchAllPageProps = {
  params: Promise<{ slug?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminCatchAllPage({
  params,
  searchParams,
}: AdminCatchAllPageProps) {
  const { slug = [] } = await params;

  if (slug.length === 0) {
    return <AdminHomePage />;
  }

  if (slug.length === 1) {
    if (slug[0] === "analytics") return <AnalyticsPage />;
    if (slug[0] === "chatbot") return <ChatbotAdminPage />;
    if (slug[0] === "diagnostics") {
      return <AdminDiagnosticsPage searchParams={searchParams} />;
    }
    if (slug[0] === "login") {
      return (
        <AdminLoginPage
          searchParams={
            searchParams as Promise<{ error?: string; next?: string }>
          }
        />
      );
    }
    if (slug[0] === "render-errors") {
      return <RenderErrorsPage searchParams={searchParams} />;
    }
  }

  if (slug.length === 2 && slug[0] === "diagnostics") {
    return (
      <SessionDiagnosticsPage
        params={Promise.resolve({ sessionId: slug[1] })}
      />
    );
  }

  notFound();
}
