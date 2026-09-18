import type {
  ApiErrorResponse,
  CreateInquiryRequest,
  CreateInquiryResponse,
  ProductResponse,
  ProductSearchResponse,
  SavedInquiryDetail,
  SavedInquiryListResponse,
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
    cache: "no-store",
    credentials: "same-origin",
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
  const response = await fetch(`/api/products/${encodeURIComponent(code)}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw await toApiError(response);
  const data = (await response.json()) as ProductResponse;
  return data.product;
}

export async function createInquiryRequest(
  payload: CreateInquiryRequest,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/api/inquiries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) throw await toApiError(response);

  const data = (await response.json()) as CreateInquiryResponse;
  return data.inquiryId;
}

export async function listSavedInquiriesRequest(
  params: string,
  signal?: AbortSignal,
): Promise<SavedInquiryListResponse> {
  const suffix = params === "" ? "" : `?${params}`;
  const response = await fetch(`/api/inquiries${suffix}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as SavedInquiryListResponse;
}

export async function getSavedInquiryRequest(
  id: string,
  signal?: AbortSignal,
): Promise<SavedInquiryDetail> {
  const response = await fetch(`/api/inquiries/${encodeURIComponent(id)}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw await toApiError(response);
  const data = (await response.json()) as { inquiry: SavedInquiryDetail };
  return data.inquiry;
}

export async function exportSavedInquiriesRequest(
  params: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  const suffix = params === "" ? "" : `?${params}`;
  const response = await fetch(`/api/inquiries/export${suffix}`, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw await toApiError(response);
  const header = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(header);
  return {
    blob: await response.blob(),
    filename: match?.[1] ?? "saved-inquiries.csv",
  };
}
