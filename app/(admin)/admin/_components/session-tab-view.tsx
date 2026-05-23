"use client";

import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Input,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
} from "@fluentui/react-components";
import type { SelectTabData, SelectTabEvent } from "@fluentui/react-components";
import type { DashboardSession, SessionStatusGroup } from "@/lib/admin/session-dashboard";
import { forceExpireSession, forceResetSession } from "../actions";

type SessionTab = "live" | "success" | "closed" | "problem" | "all";

const TABS: { group?: SessionStatusGroup; id: SessionTab; label: string }[] = [
  { id: "live", label: "Live", group: "live" },
  { id: "success", label: "Completed", group: "success" },
  { id: "closed", label: "Expired", group: "closed" },
  { id: "problem", label: "Failed", group: "problem" },
  { id: "all", label: "All" },
];

function relativeTime(isoString: string, now: number): string {
  const diffMs = now - new Date(isoString).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatCountdown(isoString: string | null, now: number): string {
  if (!isoString) return "-";
  const diffMs = new Date(isoString).getTime() - now;
  if (diffMs <= 0) return "expired";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function productName(selectedProduct: unknown): string {
  if (
    selectedProduct !== null &&
    typeof selectedProduct === "object" &&
    "name" in selectedProduct &&
    typeof (selectedProduct as Record<string, unknown>).name === "string"
  ) {
    return (selectedProduct as Record<string, string>).name;
  }
  return "-";
}

function statusColor(status: string) {
  if (status === "failed") return "danger" as const;
  if (status === "result_ready" || status === "completed") return "success" as const;
  if (status === "rendering" || status === "ready_to_render") return "important" as const;
  if (status === "mobile_connected" || status === "room_selected" || status === "product_selected") {
    return "informative" as const;
  }
  return "subtle" as const;
}

function StatusBadge({
  effectivelyExpired,
  status,
}: {
  effectivelyExpired: boolean;
  status: string;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Badge appearance="tint" color={statusColor(status)}>
        {status.replace(/_/g, " ")}
      </Badge>
      {effectivelyExpired && status !== "expired" ? (
        <Badge appearance="tint" color="warning">overdue</Badge>
      ) : null}
    </span>
  );
}

function SessionActions({ session }: { session: DashboardSession }) {
  if (session.status === "expired" || session.status === "completed") return null;

  return (
    <div className="flex items-center gap-2">
      {session.group !== "closed" ? (
        <form action={forceExpireSession.bind(null, session.id)}>
          <Button appearance="subtle" size="small" type="submit">
            Expire
          </Button>
        </form>
      ) : null}
      <form action={forceResetSession.bind(null, session.id)}>
        <Button appearance="secondary" size="small" type="submit">
          Reset
        </Button>
      </form>
    </div>
  );
}

function SessionRows({
  now,
  sessions,
}: {
  now: number;
  sessions: DashboardSession[];
}) {
  if (sessions.length === 0) {
    return (
      <div className="px-6 py-12 text-center">
        <Text className="text-slate-500" size={300}>No sessions in this category.</Text>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table aria-label="Room preview sessions" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Session</TableHeaderCell>
            <TableHeaderCell>Status</TableHeaderCell>
            <TableHeaderCell>Mobile</TableHeaderCell>
            <TableHeaderCell>Product</TableHeaderCell>
            <TableHeaderCell>Renders</TableHeaderCell>
            <TableHeaderCell>Created</TableHeaderCell>
            <TableHeaderCell>Expires</TableHeaderCell>
            <TableHeaderCell>Actions</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map((session) => (
            <TableRow key={session.id}>
              <TableCell>
                <span className="font-mono text-xs text-slate-600">{session.id.slice(0, 8)}...</span>
              </TableCell>
              <TableCell>
                <StatusBadge
                  effectivelyExpired={session.effectivelyExpired}
                  status={session.status}
                />
              </TableCell>
              <TableCell>
                <Badge appearance="tint" color={session.mobileConnected ? "success" : "subtle"}>
                  {session.mobileConnected ? "Connected" : "Waiting"}
                </Badge>
              </TableCell>
              <TableCell>
                <span className="block max-w-44 truncate text-slate-700">
                  {productName(session.selectedProduct)}
                </span>
              </TableCell>
              <TableCell>
                <span className="tabular-nums">{session.renderCount}</span>
              </TableCell>
              <TableCell>{relativeTime(session.createdAt, now)}</TableCell>
              <TableCell>{session.group === "live" ? formatCountdown(session.expiresAt, now) : "-"}</TableCell>
              <TableCell>
                <SessionActions session={session} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function SessionTabView({ sessions }: { sessions: DashboardSession[] }) {
  const [activeTab, setActiveTab] = useState<SessionTab>("live");
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());

  const counts: Record<SessionTab, number> = {
    live: sessions.filter((session) => session.group === "live").length,
    success: sessions.filter((session) => session.group === "success").length,
    closed: sessions.filter((session) => session.group === "closed").length,
    problem: sessions.filter((session) => session.group === "problem").length,
    all: sessions.length,
  };

  const visible = useMemo(() => {
    const tab = TABS.find((item) => item.id === activeTab);
    const byTab = activeTab === "all"
      ? sessions
      : sessions.filter((session) => session.group === tab?.group);
    const normalized = query.trim().toLowerCase();
    if (!normalized) return byTab;
    return byTab.filter((session) =>
      session.id.toLowerCase().includes(normalized) ||
      session.status.toLowerCase().includes(normalized) ||
      productName(session.selectedProduct).toLowerCase().includes(normalized)
    );
  }, [activeTab, query, sessions]);

  function handleTabSelect(_event: SelectTabEvent, data: SelectTabData) {
    setActiveTab(data.value as SessionTab);
  }

  return (
    <Card className="border border-slate-200 shadow-sm" size="large">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <TabList selectedValue={activeTab} onTabSelect={handleTabSelect}>
          {TABS.map((tab) => (
            <Tab key={tab.id} value={tab.id}>
              <span className="inline-flex items-center gap-2">
                {tab.label}
                <Badge appearance="filled" color={tab.id === "problem" ? "danger" : "brand"} size="small">
                  {counts[tab.id]}
                </Badge>
              </span>
            </Tab>
          ))}
        </TabList>
        <Input
          aria-label="Filter sessions"
          className="w-full lg:w-72"
          onChange={(_event, data) => setQuery(data.value)}
          placeholder="Filter session, status, product..."
          value={query}
        />
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-white">
        <SessionRows now={now} sessions={visible} />
      </div>

      <Text className="mt-3 text-slate-500" size={200}>
        Showing {visible.length} of {sessions.length} sessions from the active monitor window.
      </Text>
    </Card>
  );
}
