"use client";

import { useActionState } from "react";
import { Badge, Button } from "@fluentui/react-components";
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
      <Button appearance="secondary" disabled={isPending} size="small" type="submit">
        {isPending ? "Marking..." : "Mark stuck as failed"}
      </Button>
      {result && (
        <Badge appearance="tint" color={result.cleanedJobs === 0 ? "subtle" : "danger"} title={`ran at ${result.ranAt}`}>
          {result.cleanedJobs === 0
            ? "nothing stuck"
            : `${result.cleanedJobs} jobs failed`}
        </Badge>
      )}
    </form>
  );
}
