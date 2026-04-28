"use client";

import { useActionState } from "react";
import {
  markStuckRenderJobsAsFailedAction,
  type MarkStuckRenderJobsActionResult,
} from "../actions";

export function MarkStuckRenderJobsButton() {
  const [result, formAction, isPending] = useActionState<MarkStuckRenderJobsActionResult, FormData>(
    markStuckRenderJobsAsFailedAction,
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={isPending}
        className="text-xs text-amber-300 hover:text-amber-100 transition-colors px-2.5 py-1.5 rounded-md hover:bg-amber-950/40 disabled:opacity-40 disabled:cursor-not-allowed border border-amber-900/60"
      >
        {isPending ? "Marking..." : "Mark stuck as failed"}
      </button>
      {result && (
        <span className="text-xs text-gray-600 whitespace-nowrap" title={`ran at ${result.ranAt}`}>
          {result.cleanedJobs === 0
            ? "nothing stuck"
            : `${result.cleanedJobs} jobs failed`}
        </span>
      )}
    </form>
  );
}
