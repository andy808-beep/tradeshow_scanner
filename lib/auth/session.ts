import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAuthServerClient } from "@/lib/supabase/server";
import { AuthenticationError } from "./errors";

/**
 * Verifies the caller with Supabase Auth. Cookie presence is not enough:
 * `getUser()` asks the Auth server whether this session still belongs to a
 * real user.
 *
 * Application data still goes through the service-role client after this
 * check. The browser must not query `products` / `inquiries` directly — a
 * later offline PWA should cache these protected API responses instead.
 */
export async function requireAuthenticatedUser(): Promise<User> {
  const supabase = await createAuthServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new AuthenticationError();
  }

  return data.user;
}

export async function getAuthenticatedUserOrNull(): Promise<User | null> {
  try {
    return await requireAuthenticatedUser();
  } catch (error) {
    if (error instanceof AuthenticationError) return null;
    throw error;
  }
}
