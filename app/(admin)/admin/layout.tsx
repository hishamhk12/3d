import type { ReactNode } from "react";
import AdminFluentProvider from "@/components/admin/AdminFluentProvider";

export default function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AdminFluentProvider>{children}</AdminFluentProvider>;
}
