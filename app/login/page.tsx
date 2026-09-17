import type { Metadata } from "next";
import { redirect } from "next/navigation";
import LoginForm from "@/components/login-form";
import { safeNextPath } from "@/lib/auth/paths";
import { getAuthenticatedUserOrNull } from "@/lib/auth/session";
import { SupabaseConfigError } from "@/lib/supabase/errors";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in · Koei Porcelain",
  robots: { index: false, follow: false },
};

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const nextPath = safeNextPath(searchParams.next);

  let signedIn = false;
  try {
    signedIn = (await getAuthenticatedUserOrNull()) !== null;
  } catch (error) {
    if (!(error instanceof SupabaseConfigError)) throw error;
  }

  if (signedIn) {
    redirect(nextPath ?? "/");
  }

  return (
    <>
      <header className="bg-porcelain-800 px-4 py-3 text-white shadow-sm">
        <p className="text-base leading-tight font-semibold tracking-tight">
          Koei Porcelain
        </p>
        <p className="text-xs text-porcelain-200">Trade show inquiry tool</p>
      </header>
      <main className="flex-1 px-4 py-6">
        <h1 className="text-lg font-semibold text-porcelain-950">Sign in</h1>
        <p className="mt-1 mb-5 text-sm text-porcelain-600">
          Employee access only. Accounts are issued by an administrator.
        </p>
        <LoginForm nextPath={nextPath} />
      </main>
    </>
  );
}
