"use client";

// Client tab shell for /admin/chatbot. Uses Fluent UI TabList to match the admin
// design system. Status is fetched once here and shared between Overview and
// Settings, so switching tabs does not make extra requests.
import { useEffect, useState } from "react";
import { Tab, TabList, type SelectTabData } from "@fluentui/react-components";
import OverviewTab from "./OverviewTab";
import ImportTab from "./ImportTab";
import SellersTab from "./SellersTab";
import ShowroomsTab from "./ShowroomsTab";
import ActivityTab from "./ActivityTab";
import SettingsTab from "./SettingsTab";
import { apiGet, errorMessage } from "./client-api";
import type { AdminChatbotStatus, StatusState } from "./status-types";

type TabValue = "overview" | "import" | "sellers" | "showrooms" | "activity" | "settings";

export default function ChatbotAdmin() {
  const [tab, setTab] = useState<TabValue>("overview");
  const [status, setStatus] = useState<AdminChatbotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const r = await apiGet<AdminChatbotStatus>("/api/admin/chatbot/status");
      if (ignore) return;
      if (!r.ok) {
        setError(errorMessage(r, "Could not load chatbot status."));
      } else {
        setError(null);
        setStatus(r.data);
      }
      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [reloadKey]);

  const statusState: StatusState = {
    status,
    loading,
    error,
    refresh: () => {
      setLoading(true);
      setError(null);
      setReloadKey((k) => k + 1);
    },
  };

  return (
    <div className="space-y-5">
      <TabList
        selectedValue={tab}
        onTabSelect={(_, d: SelectTabData) => setTab(d.value as TabValue)}
        size="medium"
      >
        <Tab value="overview">Overview</Tab>
        <Tab value="import">Inventory Import</Tab>
        <Tab value="sellers">Sellers</Tab>
        <Tab value="showrooms">Showrooms</Tab>
        <Tab value="activity">Activity</Tab>
        <Tab value="settings">Settings &amp; Status</Tab>
      </TabList>

      <div>
        {tab === "overview" && <OverviewTab state={statusState} />}
        {tab === "import" && <ImportTab />}
        {tab === "sellers" && <SellersTab />}
        {tab === "showrooms" && <ShowroomsTab />}
        {tab === "activity" && <ActivityTab />}
        {tab === "settings" && <SettingsTab state={statusState} />}
      </div>
    </div>
  );
}
