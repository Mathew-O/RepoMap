import type { ApiError, ApiErrorCode } from "@/lib/types";

const DEFAULT_STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  INVALID_URL: 400,
  NOT_FOUND: 404,
  PRIVATE_REPO: 403,
  REF_NOT_FOUND: 404,
  EMPTY_REPO: 422,
  RATE_LIMITED: 429,
  BAD_TOKEN: 401,
  FORBIDDEN: 403,
  BLOCKED: 451,
  UPSTREAM: 502,
  NETWORK: 504,
  AI_UNAVAILABLE: 503,
  AI_RATE_LIMITED: 429,
  AI_REFUSED: 422,
  AI_ERROR: 502,
};

/** An error that's safe to show to the user as-is. */
export class RepoMapError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly hint?: string;
  readonly resetAt?: string;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { status?: number; hint?: string; resetAt?: string } = {},
  ) {
    super(message);
    this.name = "RepoMapError";
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.hint = options.hint;
    this.resetAt = options.resetAt;
  }

  toJSON(): ApiError {
    return {
      code: this.code,
      message: this.message,
      ...(this.hint ? { hint: this.hint } : {}),
      ...(this.resetAt ? { resetAt: this.resetAt } : {}),
    };
  }
}
