"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface AutoRefreshProps {
  intervalSeconds?: number;
}

/**
 * Invisible client component that calls router.refresh() on a fixed interval.
 * Because all dashboard data lives in async Server Components, a refresh
 * re-fetches everything server-side with zero client state.
 */
export function AutoRefresh({ intervalSeconds = 15 }: AutoRefreshProps) {
  const router = useRouter();
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh();
      setLastRefresh(new Date());
    }, intervalSeconds * 1000);

    return () => clearInterval(id);
  }, [router, intervalSeconds]);

  return (
    <span className="text-xs text-gray-600" title={`Refreshes every ${intervalSeconds}s`}>
      &#8635; {intervalSeconds}s &mdash; last{" "}
      {lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </span>
  );
}
