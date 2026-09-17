import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInAction: vi.fn(),
  signOutAction: vi.fn(),
}));

vi.mock("@/lib/auth/actions", () => ({
  signInAction: mocks.signInAction,
  signOutAction: mocks.signOutAction,
}));

const { default: LoginForm } = await import("@/components/login-form");
const { default: SiteHeader } = await import("@/components/site-header");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInAction.mockResolvedValue({ error: "Invalid email or password." });
});

describe("login form", () => {
  it("has email, password and sign-in, with no public sign-up UI", () => {
    render(<LoginForm nextPath={null} />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /sign up|register|create account/i })).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.queryByText(/register/i)).toBeNull();
    expect(screen.queryByText(/google|github|azure|facebook/i)).toBeNull();
  });

  it("shows the invalid-login error from the server action", async () => {
    render(<LoginForm nextPath="/inquiry" />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "andy@koeico.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid email or password.");
    });
    expect(screen.getByRole("alert").textContent).not.toContain("wrong-password");
    expect(mocks.signInAction).toHaveBeenCalled();
  });

  it("does not put the password in the next hidden field or action URL", () => {
    const { container } = render(<LoginForm nextPath="/labels" />);
    const hidden = container.querySelector('input[name="next"]');
    expect(hidden).toHaveAttribute("value", "/labels");
    expect(container.querySelector("form")?.getAttribute("action") ?? "").not.toMatch(
      /password/i,
    );
  });
});

describe("account control", () => {
  it("shows the employee email and a logout button", () => {
    render(<SiteHeader email="andy@koeico.com" />);
    expect(screen.getByText("andy@koeico.com")).toBeVisible();
    expect(screen.getByRole("button", { name: "Log out" })).toBeVisible();
  });
});

describe("no public sign-up route or copy", () => {
  it("does not ship a registration page", () => {
    const login = readFileSync(
      path.join(process.cwd(), "app", "login", "page.tsx"),
      "utf8",
    );
    const form = readFileSync(
      path.join(process.cwd(), "components", "login-form.tsx"),
      "utf8",
    );
    const combined = `${login}\n${form}`;
    expect(combined).not.toMatch(/signUp|sign-up|create account|register/i);
    expect(combined).toMatch(/Employee access only/);
  });
});
