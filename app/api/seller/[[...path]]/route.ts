import { type NextRequest, NextResponse } from "next/server";
import { POST as loginPost } from "../auth/login/handler";
import { POST as logoutPost } from "../auth/logout/handler";
import { GET as meGet } from "../auth/me/handler";
import { POST as chatPost } from "../chat/handler";
import { GET as codeSuggestionsGet } from "../inventory/code-suggestions/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type CatchAllContext = {
  params: Promise<{ path?: string[] }>;
};

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

  if (joined === "auth/login") {
    return method === "POST" ? loginPost(request) : methodNotAllowed();
  }
  if (joined === "auth/logout") {
    return method === "POST" ? logoutPost() : methodNotAllowed();
  }
  if (joined === "auth/me") {
    return method === "GET" ? meGet() : methodNotAllowed();
  }
  if (joined === "chat") {
    return method === "POST" ? chatPost(request) : methodNotAllowed();
  }
  if (joined === "inventory/code-suggestions") {
    return method === "GET" ? codeSuggestionsGet(request) : methodNotAllowed();
  }

  return notFound();
}

export function GET(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function POST(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}
