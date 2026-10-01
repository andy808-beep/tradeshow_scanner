import { zh } from "@/lib/i18n/zh-cn";

export class AuthenticationError extends Error {
  constructor() {
    super(zh.auth.loginRequired);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message = zh.auth.notAuthorized) {
    super(message);
    this.name = "AuthorizationError";
  }
}
