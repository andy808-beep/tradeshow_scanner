"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/server";
import { authenticateEmployee } from "./credentials";
import { safeNextPath } from "./paths";

export type SignInState = { error: string } | null;

export async function signInAction(
  _previous: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next")) ?? "/";

  const result = await authenticateEmployee(email, password);
  if (!result.ok) return { error: result.error };

  redirect(next);
}

export async function signOutAction(): Promise<void> {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
