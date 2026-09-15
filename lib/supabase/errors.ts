/**
 * Error types shared by the Supabase modules and the route handlers.
 *
 * These live outside `admin.ts` so that mapping an error to an HTTP status does
 * not pull the `server-only` administrative client into the module graph.
 */

export class SupabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupabaseConfigError";
  }
}

/** A query reached Supabase but failed. Surfaced to the UI as "unavailable". */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

/** Input rejected after checking it against the database. */
export class InquiryValidationError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "InquiryValidationError";
    this.details = details;
  }
}
