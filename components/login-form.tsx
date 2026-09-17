"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/lib/auth/actions";

const fieldClasses =
  "h-11 w-full rounded-lg border border-porcelain-300 bg-white px-3 text-base text-porcelain-950 placeholder:text-porcelain-400 focus:border-porcelain-500 focus:ring-2 focus:ring-porcelain-200 focus:outline-none disabled:bg-porcelain-50";

const labelClasses = "mb-1 block text-sm font-medium text-porcelain-700";

export default function LoginForm({ nextPath }: { nextPath: string | null }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(
    signInAction,
    null,
  );

  return (
    <form action={action} className="space-y-4" noValidate>
      {nextPath ? <input type="hidden" name="next" value={nextPath} /> : null}

      <div>
        <label htmlFor="email" className={labelClasses}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          disabled={pending}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "sign-in-error" : undefined}
          className={fieldClasses}
        />
      </div>

      <div>
        <label htmlFor="password" className={labelClasses}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
          aria-invalid={state?.error ? true : undefined}
          aria-describedby={state?.error ? "sign-in-error" : undefined}
          className={fieldClasses}
        />
      </div>

      {state?.error ? (
        <p
          id="sign-in-error"
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
        >
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="h-11 w-full rounded-xl bg-porcelain-700 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-porcelain-800 disabled:opacity-70"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
