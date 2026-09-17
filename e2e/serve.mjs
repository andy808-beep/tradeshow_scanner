import { spawn } from "node:child_process";
import { startSupabaseMock } from "./supabase-mock.mjs";

/**
 * Boots the browser-level test stack: a local stand-in Supabase project, a
 * production build against it, and `next start`.
 */

const SUPABASE_PORT = Number(process.env.E2E_SUPABASE_PORT ?? 54321);
const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3210);
const SUPABASE_URL = `http://127.0.0.1:${SUPABASE_PORT}`;

const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_e2e",
  SUPABASE_URL,
  SUPABASE_SECRET_KEY: "sb_secret_e2e",
  NEXT_TELEMETRY_DISABLED: "1",
};

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", args, { env, stdio: "inherit", shell: true });
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${args.join(" ")} exited ${code}`)),
    );
  });
}

const mock = await startSupabaseMock(SUPABASE_PORT);
console.log(`[e2e] Supabase stand-in listening on ${SUPABASE_URL}`);

if (process.env.E2E_SKIP_BUILD !== "1") {
  console.log("[e2e] building the production bundle");
  await run(["next", "build"]);
}

const app = spawn("npx", ["next", "start", "--port", String(APP_PORT)], {
  env,
  stdio: "inherit",
  shell: true,
});

function shutdown() {
  app.kill();
  mock.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.on("exit", (code) => {
  mock.close();
  process.exit(code ?? 0);
});
