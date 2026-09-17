import type {
  ApiErrorResponse,
  CreateInquiryRequest,
  CreateInquiryResponse,
  ProductResponse,
  ProductSearchResponse,
} from "./api-contract";
import type { Product } from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status: number, details: string[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorResponse | null = null;
  try {
    body = (await response.json()) as ApiErrorResponse;
  } catch {
    // Fall through to the generic message below.
  }
  return new ApiError(
    body?.error ?? "The request failed.",
    response.status,
    body?.details ?? [],
  );
}

export async function searchProductsRequest(
  query: string,
  signal: AbortSignal,
): Promise<Product[]> {
  const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`, {
    signal,
  });

  if (!response.ok) throw await toApiError(response);

  const data = (await response.json()) as ProductSearchResponse;
  return data.products;
}

export async function listLabelProductsRequest(
  query: string,
  signal?: AbortSignal,
): Promise<Product[]> {
  const params = query.trim() === "" ? "" : `?q=${encodeURIComponent(query.trim())}`;
  const response = await fetch(`/api/products/labels${params}`, { signal });

  if (!response.ok) throw await toApiError(response);

  const data = (await response.json()) as ProductSearchResponse;
  return data.products;
}

export async function getProductByCodeRequest(code: string): Promise<Product | null> {
  const response = await fetch(`/api/products/${encodeURIComponent(code)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw await toApiError(response);
  const data = (await response.json()) as ProductResponse;
  return data.product;
}

export async function createInquiryRequest(
  payload: CreateInquiryRequest,
): Promise<string> {
  const response = await fetch("/api/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) throw await toApiError(response);

  const data = (await response.json()) as CreateInquiryResponse;
  return data.inquiryId;
}
