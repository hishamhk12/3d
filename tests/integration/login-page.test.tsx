// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { LoginClient } from "@/app/login/login-client";

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Login page mode locking", () => {
  it("renders only the seller login form for type=seller", () => {
    render(<LoginClient mode="seller" />);

    expect(screen.getByRole("heading", { name: "تسجيل دخول البائع" })).toBeTruthy();
    expect(screen.getByLabelText("رمز البائع")).toBeTruthy();
    expect(screen.getByLabelText("رمز المعرض")).toBeTruthy();
    expect(screen.getByLabelText("كلمة المرور")).toBeTruthy();
    expect(screen.getByRole("button", { name: "تسجيل الدخول" })).toBeTruthy();

    expect(screen.queryByText("عميل")).toBeNull();
    expect(screen.queryByRole("button", { name: "عميل" })).toBeNull();
    expect(screen.queryByText("المتابعة كعميل")).toBeNull();
  });

  it("renders only the customer flow for type=customer", () => {
    render(<LoginClient mode="customer" />);

    expect(screen.getByRole("heading", { name: "تسجيل الدخول" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "المتابعة كعميل" })).toBeTruthy();

    expect(screen.queryByLabelText("رمز البائع")).toBeNull();
    expect(screen.queryByLabelText("رمز المعرض")).toBeNull();
    expect(screen.queryByLabelText("كلمة المرور")).toBeNull();
    expect(screen.queryByRole("button", { name: "بائع" })).toBeNull();
  });

  it("keeps seller login posting to the existing API and redirects to seller chat", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, redirectTo: "/seller/chat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<LoginClient mode="seller" />);

    fireEvent.change(screen.getByLabelText("رمز البائع"), { target: { value: "S001" } });
    fireEvent.change(screen.getByLabelText("رمز المعرض"), { target: { value: "RIYADH" } });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), { target: { value: "seller-pass-1" } });
    fireEvent.click(screen.getByRole("button", { name: "تسجيل الدخول" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/seller/auth/login",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sellerCode: "S001",
          showroomCode: "RIYADH",
          password: "seller-pass-1",
        }),
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/seller/chat"));
  });
});
