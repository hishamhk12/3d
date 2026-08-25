import { loginAction } from "./actions";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>;
}

export const metadata = {
  title: "Admin Login - Ibdaa 360",
};

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const { error, next } = await searchParams;
  const hasError = error === "1";

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex size-12 items-center justify-center rounded-xl bg-[#115ea3] text-white">
            <span className="text-lg font-bold">I</span>
          </div>
          <h1 className="text-xl font-semibold text-slate-950">Admin Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Ibdaa 360 Operations</p>
        </div>

        {hasError ? (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Invalid username or password.
          </div>
        ) : null}

        <form action={loginAction} className="space-y-4">
          {next ? <input name="next" type="hidden" value={next} /> : null}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="username">
              Username
            </label>
            <input
              autoComplete="username"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 placeholder-slate-400 focus:border-[#115ea3] focus:outline-none focus:ring-2 focus:ring-[#115ea3]/20"
              id="username"
              name="username"
              placeholder="admin"
              required
              type="text"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="password">
              Password
            </label>
            <input
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 placeholder-slate-400 focus:border-[#115ea3] focus:outline-none focus:ring-2 focus:ring-[#115ea3]/20"
              id="password"
              name="password"
              placeholder="Password"
              required
              type="password"
            />
          </div>

          <button
            className="w-full rounded-lg bg-[#115ea3] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0f548c] focus:outline-none focus:ring-2 focus:ring-[#115ea3] focus:ring-offset-2"
            type="submit"
          >
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}
