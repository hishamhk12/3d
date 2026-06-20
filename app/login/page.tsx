import { LoginClient, type LoginMode } from "./login-client";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveMode(type: string | string[] | undefined): LoginMode {
  const value = Array.isArray(type) ? type[0] : type;
  if (value === "seller") return "seller";
  if (value === "customer") return "customer";
  return "default";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return <LoginClient mode={resolveMode(params?.type)} />;
}
