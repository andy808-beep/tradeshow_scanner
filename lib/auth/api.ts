import "server-only";

import { handleRouteError } from "@/lib/api-response";
import { requireAuthenticatedUser } from "./session";

/**
 * Wraps an App Router route handler so every application-data endpoint
 * verifies the employee with Supabase Auth before doing any work.
 */
export function withAuthenticatedApi<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      await requireAuthenticatedUser();
      return await handler(...args);
    } catch (error) {
      return handleRouteError(error);
    }
  };
}
