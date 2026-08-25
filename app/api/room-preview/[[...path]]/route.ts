import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type CatchAllContext = {
  params: Promise<{ path?: string[] }>;
};

function sessionContext(sessionId: string) {
  return { params: Promise.resolve({ sessionId }) };
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

  if (path.length === 1 && path[0] === "cleanup") {
    if (method !== "GET") return methodNotAllowed();
    const { GET } = await import("../cleanup/handler");
    return GET(request);
  }

  if (path.join("/") === "mobile/gate") {
    if (method !== "POST") return methodNotAllowed();
    const { POST } = await import("../mobile/gate/handler");
    return POST(request);
  }

  if (path.join("/") === "mobile/products") {
    if (method !== "GET") return methodNotAllowed();
    const { GET } = await import("../mobile/products/handler");
    return GET(request);
  }

  if (path.join("/") === "mobile/request-retry") {
    if (method !== "POST") return methodNotAllowed();
    const { POST } = await import("../mobile/request-retry/handler");
    return POST(request);
  }

  if (path.length === 1 && path[0] === "sessions") {
    if (method !== "POST") return methodNotAllowed();
    const { POST } = await import("../sessions/handler");
    return POST(request);
  }

  if (path.length >= 2 && path[0] === "sessions") {
    const sessionId = path[1];
    const child = path.slice(2).join("/");
    const ctx = sessionContext(sessionId);

    if (!child) {
      if (method !== "GET") return methodNotAllowed();
      const { GET } = await import("../sessions/[sessionId]/handler");
      return GET(request, ctx);
    }
    if (child === "abandon") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/abandon/handler");
      return POST(request, ctx);
    }
    if (child === "activate") {
      if (method === "GET") {
        const { GET } = await import("../sessions/[sessionId]/activate/handler");
        return GET(request, ctx);
      }
      if (method === "POST") {
        const { POST } = await import("../sessions/[sessionId]/activate/handler");
        return POST(request, ctx);
      }
      return methodNotAllowed();
    }
    if (child === "connect") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/connect/handler");
      return POST(request, ctx);
    }
    if (child === "diagnostics") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/diagnostics/handler");
      return POST(request, ctx);
    }
    if (child === "events") {
      if (method !== "GET") return methodNotAllowed();
      const { GET } = await import("../sessions/[sessionId]/events/handler");
      return GET(request, ctx);
    }
    if (child === "heartbeat") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/heartbeat/handler");
      return POST(request, ctx);
    }
    if (child === "product") {
      if (method === "POST") {
        const { POST } = await import("../sessions/[sessionId]/product/handler");
        return POST(request, ctx);
      }
      if (method === "DELETE") {
        const { DELETE } = await import("../sessions/[sessionId]/product/handler");
        return DELETE(request, ctx);
      }
      return methodNotAllowed();
    }
    if (child === "render") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/render/handler");
      return POST(request, ctx);
    }
    if (child === "room") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/room/handler");
      return POST(request, ctx);
    }
    if (child === "room/confirm-upload") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/room/confirm-upload/handler");
      return POST(request, ctx);
    }
    if (child === "room/upload-url") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/room/upload-url/handler");
      return POST(request, ctx);
    }
    if (child === "screen-token") {
      if (method !== "POST") return methodNotAllowed();
      const { POST } = await import("../sessions/[sessionId]/screen-token/handler");
      return POST(request, ctx);
    }
  }

  return notFound();
}

export function GET(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function POST(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}

export function DELETE(request: NextRequest, context: CatchAllContext) {
  return dispatch(request, context);
}
