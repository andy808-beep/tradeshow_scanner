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

vi.mock("@/components/catalogue-provider", () => ({
  useCatalogue: () => ({
    resetLocal: vi.fn(),
  }),
}));

vi.mock("@/components/inquiry-store", () => ({
  useInquiry: () => ({
    clearInquiry: vi.fn(),
  }),
}));

const { default: LoginForm } = await import("@/components/login-form");
const { default: SiteHeader } = await import("@/components/site-header");

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signInAction.mockResolvedValue({ error: "邮箱或密码不正确。" });
});

describe("login form", () => {
  it("has email, password and sign-in, with no public sign-up UI", () => {
    render(<LoginForm nextPath={null} />);

    expect(screen.getByLabelText("电子邮箱")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("密码")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "登录" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /sign up|register|create account/i })).toBeNull();
    expect(screen.queryByText(/sign up/i)).toBeNull();
    expect(screen.queryByText(/register/i)).toBeNull();
    expect(screen.queryByText(/google|github|azure|facebook/i)).toBeNull();
  });

  it("shows the invalid-login error from the server action", async () => {
    render(<LoginForm nextPath="/inquiry" />);

    fireEvent.change(screen.getByLabelText("电子邮箱"), {
      target: { value: "andy@koeico.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("邮箱或密码不正确。");
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
    expect(screen.getByRole("button", { name: "退出登录" })).toBeVisible();
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
    const copy = readFileSync(
      path.join(process.cwd(), "lib", "i18n", "zh-cn.ts"),
      "utf8",
    );
    const combined = `${login}\n${form}\n${copy}`;
    expect(combined).not.toMatch(/signUp|sign-up|create account|register/i);
    expect(copy).toMatch(/仅供已获授权的 Koei 员工使用/);
  });
});
