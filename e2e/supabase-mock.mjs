import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";

/**
 * A stand-in Supabase project for the browser-level offline test.
 *
 * The application's own auth boundary is exercised unchanged: the proxy still
 * verifies a JWT, the catalogue route still calls `requireAuthenticatedUser`,
 * and product rows still arrive through the service-role client. Only the
 * Supabase project behind it is local.
 */

export const TEST_EMAIL = "booth@koei.test";
export const TEST_PASSWORD = "booth-password";
export const FEATURED_CODE = "K10188-13";
export const CATALOGUE_SIZE = 102;

const JWT_SECRET = "koei-offline-e2e-secret";
const USER_ID = "7b1d7bb0-0000-4000-8000-000000000001";

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signJwt(payload) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${body}.${signature}`;
}

function user() {
  const now = new Date().toISOString();
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: TEST_EMAIL,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  };
}

function session(issuer) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + 3600;
  return {
    access_token: signJwt({
      iss: `${issuer}/auth/v1`,
      sub: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: TEST_EMAIL,
      session_id: randomUUID(),
      iat: issuedAt,
      exp: expiresAt,
      is_anonymous: false,
    }),
    token_type: "bearer",
    expires_in: 3600,
    expires_at: expiresAt,
    refresh_token: randomUUID(),
    user: user(),
  };
}

/** 102 active products, ordered by code, with one richly populated row. */
export function catalogueRows() {
  const featured = {
    id: "e4247a2f-1e3b-4d64-a05f-ab38906b5292",
    product_code: FEATURED_CODE,
    barcode: "4901234567894",
    chinese_name: "大方盘·紫",
    english_name: "Abbesses Plate - L",
    unit_price: 2.4,
    currency: "USD",
    dimensions: "20.6 × 13.3 × 2.0 cm",
    packaging: "24 pcs/ctn",
    image_url: null,
  };

  const rest = Array.from({ length: CATALOGUE_SIZE - 1 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    product_code: `K${9000 + index}-01`,
    barcode: null,
    chinese_name: `杯碟-${index}`,
    english_name: `Cup and Saucer ${index}`,
    // A null listed price must survive the round trip untouched.
    unit_price: index === 0 ? null : index + 0.5,
    currency: "USD",
    dimensions: "10.0 × 10.0 × 5.0 cm",
    packaging: null,
    image_url: null,
  }));

  return [featured, ...rest].sort((a, b) =>
    a.product_code.localeCompare(b.product_code),
  );
}

function json(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    return {};
  }
}

export function startSupabaseMock(port) {
  const issuer = `http://127.0.0.1:${port}`;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    const path = url.pathname;

    if (path === "/auth/v1/token") {
      const body = await readBody(request);
      const grant = url.searchParams.get("grant_type");
      if (
        grant === "password" &&
        (body.email !== TEST_EMAIL || body.password !== TEST_PASSWORD)
      ) {
        return json(response, 400, {
          error: "invalid_grant",
          error_description: "Invalid login credentials",
        });
      }
      return json(response, 200, session(issuer));
    }

    if (path === "/auth/v1/user") {
      const token = (request.headers.authorization ?? "").replace("Bearer ", "");
      // Any signed, unexpired token this mock issued identifies the employee.
      if (token.split(".").length !== 3) {
        return json(response, 401, { message: "invalid claim" });
      }
      return json(response, 200, user());
    }

    if (path === "/auth/v1/logout") {
      response.writeHead(204).end();
      return;
    }

    if (path === "/auth/v1/.well-known/jwks.json") {
      // No asymmetric keys, so the client verifies through /auth/v1/user.
      return json(response, 200, { keys: [] });
    }

    if (path === "/rest/v1/products") {
      return json(response, 200, catalogueRows());
    }

    return json(response, 404, { message: `unhandled ${path}` });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
