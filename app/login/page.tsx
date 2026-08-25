import { Suspense } from "react";
import { LoginClient, LoginClientFromSearchParams } from "./login-client";

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginClient mode="default" />}>
      <LoginClientFromSearchParams />
    </Suspense>
  );
}
