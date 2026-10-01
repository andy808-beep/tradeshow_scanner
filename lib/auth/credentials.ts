import "server-only";

import { createAuthServerClient } from "@/lib/supabase/server";
import { zh } from "@/lib/i18n/zh-cn";
import { SupabaseConfigError } from "@/lib/supabase/errors";

export type EmployeeSignInResult =
  | { ok: true }
  | { ok: false; error: string };

const INVALID_CREDENTIALS = zh.auth.invalidCredentials;
const REQUIRED_FIELDS = zh.auth.requiredFields;
const UNAVAILABLE = zh.errors.network;

/**
 * Email/password sign-in for booth staff. The password is never returned,
 * logged, or included in the result.
 */
export async function authenticateEmployee(
  email: string,
  password: string,
): Promise<EmployeeSignInResult> {
  const trimmedEmail = email.trim();
  if (trimmedEmail === "" || password === "") {
    return { ok: false, error: REQUIRED_FIELDS };
  }

  try {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      return { ok: false, error: INVALID_CREDENTIALS };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof SupabaseConfigError) {
      return { ok: false, error: UNAVAILABLE };
    }
    throw error;
  }
}
