"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, Text, Button, Spinner } from "@fluentui/react-components";
import { RefreshCcw } from "lucide-react";
import type { SystemHealthResponse } from "@/app/api/admin/system-health/route";

type BadgeColor = "success" | "danger" | "important" | "severe" | "subtle" | "informative";

function statusBadge(ok: boolean, label: string, warnLabel?: string): {
  color: BadgeColor;
  text: string;
} {
  if (ok) return { color: "success", text: label };
  if (warnLabel) return { color: "important", text: warnLabel };
  return { color: "danger", text: "Error" };
}

function formatLatency(ms: number | null): string {
  if (ms === null) return "";
  return ` · ${ms}ms`;
}

function formatCheckedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function SystemHealthCard() {
  const [data, setData] = useState<SystemHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/system-health", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as SystemHealthResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch health");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHealth();
  }, [fetchHealth]);

  const rows: Array<{
    label: string;
    badge: { color: BadgeColor; text: string };
    note: string;
    warning?: string;
  }> = data
    ? [
        {
          label: "Database",
          badge: statusBadge(data.database.connected, "Connected", data.database.configured ? "Unreachable" : "Missing"),
          note: data.database.connected
            ? `Responding${formatLatency(data.database.latencyMs)}`
            : data.database.configured
              ? "Connection failed"
              : "DATABASE_URL not set",
        },
        {
          label: "Redis",
          badge: data.redis.connected
            ? { color: "success", text: "Connected" }
            : data.redis.configured && !data.redis.enabled
              ? { color: "subtle", text: "Disabled" }
              : data.redis.configured
                ? { color: "important", text: "Unreachable" }
                : { color: "severe", text: "Not configured" },
          note: data.redis.connected
            ? `Responding${formatLatency(data.redis.latencyMs)}`
            : data.redis.configured && !data.redis.enabled
              ? "ENABLE_REDIS=false"
              : data.redis.configured
                ? "Ping failed — check REDIS_URL"
                : "REDIS_URL not set",
          warning: !data.redis.connected
            ? "Redis is missing — screen updates may be delayed and polling fallback will be used."
            : undefined,
        },
        {
          label: "Realtime",
          badge:
            data.realtime.mode === "redis"
              ? { color: "success", text: "Redis active" }
              : { color: "important", text: "Polling only" },
          note:
            data.realtime.mode === "redis"
              ? "SSE events via Redis pub/sub"
              : "Polling fallback active — connect Redis to reduce screen delay",
        },
        {
          label: "Storage",
          badge: statusBadge(data.storage.configured, data.storage.provider.toUpperCase(), "Misconfigured"),
          note: data.storage.warning ?? (data.storage.configured ? `Provider: ${data.storage.provider}` : "Missing R2/S3 env vars"),
          warning: !data.storage.configured ? (data.storage.warning ?? "Storage env is incomplete.") : undefined,
        },
        {
          label: "Render provider",
          badge: statusBadge(data.renderProvider.configured, "Configured", "Missing"),
          note: data.renderProvider.configured ? "GEMINI_API_KEY present" : "Render provider key is missing.",
          warning: !data.renderProvider.configured ? "Render provider key is missing." : undefined,
        },
        {
          label: "Required env",
          badge:
            data.env.missing.length > 0
              ? { color: "danger", text: `${data.env.missing.length} missing` }
              : data.env.warnings.length > 0
                ? { color: "important", text: `${data.env.warnings.length} warning${data.env.warnings.length > 1 ? "s" : ""}` }
                : { color: "success", text: "OK" },
          note:
            data.env.missing.length > 0
              ? data.env.missing.join(", ")
              : data.env.warnings.length > 0
                ? `${data.env.warnings.length} warning${data.env.warnings.length > 1 ? "s" : ""} (see below)`
                : "All required variables present",
        },
      ]
    : [];

  const allWarnings: string[] = data
    ? [
        ...rows.flatMap((r) => (r.warning ? [r.warning] : [])),
        ...data.env.warnings,
      ]
    : [];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">System health</h2>
          {data && (
            <span className="text-xs text-slate-500">
              Last checked: {formatCheckedAt(data.checkedAt)}
            </span>
          )}
        </div>
        <Button
          appearance="subtle"
          size="small"
          icon={loading ? <Spinner size="tiny" /> : <RefreshCcw className="size-3.5" />}
          onClick={() => void fetchHealth()}
          disabled={loading}
        >
          {loading ? "Checking…" : "Refresh health"}
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load health data: {error}
        </div>
      ) : loading && !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="h-3 w-20 animate-pulse rounded bg-slate-200" />
              <div className="mt-4 h-5 w-12 animate-pulse rounded bg-slate-200" />
              <div className="mt-3 h-3 w-28 animate-pulse rounded bg-slate-200" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            {rows.map((row) => (
              <Card
                key={row.label}
                className="border border-slate-200 shadow-sm"
                size="medium"
              >
                <div className="flex items-start justify-between gap-3">
                  <Text className="text-slate-500" size={200} weight="semibold">
                    {row.label}
                  </Text>
                  <Badge appearance="tint" color={row.badge.color} size="small">
                    {row.badge.text}
                  </Badge>
                </div>
                <Text className="mt-2 text-sm font-semibold tabular-nums text-slate-950">
                  {row.badge.text}
                </Text>
                <Text className="text-slate-500" size={200}>
                  {row.note}
                </Text>
              </Card>
            ))}
          </div>

          {/* Session activity strip */}
          <div className="mt-4 flex gap-4 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-cyan-400" />
              <Text size={200} className="text-slate-600">
                <strong className="text-slate-900">{data.sessions.live}</strong> live session{data.sessions.live !== 1 ? "s" : ""}
              </Text>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-amber-400" />
              <Text size={200} className="text-slate-600">
                <strong className="text-slate-900">{data.sessions.rendering}</strong> rendering
              </Text>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Text size={200} className="text-slate-400">
                Realtime mode: <strong className={data.realtime.mode === "redis" ? "text-emerald-600" : "text-amber-600"}>{data.realtime.mode === "redis" ? "Redis pub/sub" : "Polling fallback"}</strong>
              </Text>
            </div>
          </div>

          {/* Warnings */}
          {allWarnings.length > 0 && (
            <div className="mt-3 space-y-2">
              {allWarnings.map((w, i) => (
                <div
                  key={i}
                  className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
                >
                  {w}
                </div>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
