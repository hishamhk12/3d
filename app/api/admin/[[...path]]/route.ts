import { type NextRequest, NextResponse } from "next/server";
import { POST as importApplyPost } from "../chatbot/import/apply/handler";
import { POST as importCancelPost } from "../chatbot/import/cancel/handler";
import { GET as importHistoryGet } from "../chatbot/import/history/handler";
import { POST as importPreviewPost } from "../chatbot/import/preview/handler";
import { GET as metricsGet } from "../chatbot/metrics/handler";
import {
  GET as sellersGet,
  POST as sellersPost,
} from "../chatbot/sellers/handler";
import { PATCH as sellerPatch } from "../chatbot/sellers/[id]/handler";
import {
  GET as showroomsGet,
  POST as showroomsPost,
} from "../chatbot/showrooms/handler";
import { PATCH as showroomPatch } from "../chatbot/showrooms/[id]/handler";
import { GET as statusGet } from "../chatbot/status/handler";
import { GET as renderPerformanceGet } from "../render-performance/handler";
import {
  GET as screensGet,
  POST as screensPost,
} from "../screens/handler";
import {
  DELETE as screenDelete,
  PATCH as screenPatch,
} from "../screens/[screenId]/handler";
import { GET as systemHealthGet } from "../system-health/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type CatchAllContext = {
  params: Promise<{ path?: string[] }>;
};

function idContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function screenContext(screenId: string) {
  return { params: Promise.resolve({ screenId }) };
}

function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404 });
}

function methodNotAllowed() {
  return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
}

async function dispatch(request: NextRequest, context: CatchAllContext) {
  const { path = [] } = await context.params;
  const method = request.method;
  const joined = path.join("/");

  if (joined === "chatbot/import/apply") {
    return method === "POST" ? importApplyPost(request) : methodNotAllowed();
  }
  if (joined === "chatbot/import/cancel") {
    return method === "POST" ? importCancelPost() : methodNotAllowed();
  }
  if (joined === "chatbot/import/history") {
    return method === "GET" ? importHistoryGet() : methodNotAllowed();
  }
  if (joined === "chatbot/import/preview") {
    return method === "POST" ? importPreviewPost(request) : methodNotAllowed();
  }
  if (joined === "chatbot/metrics") {
    return method === "GET" ? metricsGet() : methodNotAllowed();
  }
  if (joined === "chatbot/sellers") {
    if (method === "GET") return sellersGet(request);
    if (method === "POST") return sellersPost(request);
    return methodNotAllowed();
  }
  if (path.length === 3 && path[0] === "chatbot" && path[1] === "sellers") {
    return method === "PATCH" ? sellerPatch(request, idContext(path[2])) : methodNotAllowed();
  }
  if (joined === "chatbot/showrooms") {
    if (method === "GET") return showroomsGet(request);
    if (method === "POST") return showroomsPost(request);
    return methodNotAllowed();
  }
  if (path.length === 3 && path[0] === "chatbot" && path[1] === "showrooms") {
    return method === "PATCH" ? showroomPatch(request, idContext(path[2])) : methodNotAllowed();
  }
  if (joined === "chatbot/status") {
    return method === "GET" ? statusGet() : methodNotAllowed();
  }
  if (joined === "render-performance") {
    return method === "GET" ? renderPerformanceGet() : methodNotAllowed();
  }
  if (joined === "screens") {
    if (method === "GET") return screensGet();
    if (method === "POST") return screensPost(request);
    return methodNotAllowed();
  }
  if (path.length === 2 && path[0] === "screens") {
    if (method === "PATCH") return screenPatch(request, screenContext(path[1]));
    if (method === "DELETE") return screenDelete(request, screenContext(path[1]));
    return methodNotAllowed();
  }
  if (joined === "system-health") {
    return method === "GET" ? systemHealthGet() : methodNotAllowed();
  }

  return notFound();
}

export function GET(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function POST(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function PATCH(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function DELETE(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}
