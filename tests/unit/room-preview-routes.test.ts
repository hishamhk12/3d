import { describe, expect, it } from "vitest";
import { ROOM_PREVIEW_ROUTES } from "@/lib/room-preview/constants";

describe("Room Preview session routes", () => {
  it("builds encoded routes for a real session id", () => {
    expect(ROOM_PREVIEW_ROUTES.sessionApi("session/id")).toBe(
      "/api/room-preview/sessions/session%2Fid",
    );
  });

  it.each(["", "   ", "null", "undefined"])(
    "never builds a route from an invalid session id: %j",
    (sessionId) => {
      expect(() => ROOM_PREVIEW_ROUTES.sessionApi(sessionId)).toThrow(
        "A valid Room Preview session id is required",
      );
      expect(() => ROOM_PREVIEW_ROUTES.screenSession(sessionId)).toThrow(
        "A valid Room Preview session id is required",
      );
    },
  );
});
