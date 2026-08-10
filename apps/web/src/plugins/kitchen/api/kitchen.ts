import { getApiUrl } from "@/lib/api/client";
import type {
  KitchenMenuCategory,
  KitchenTicket,
} from "./kitchen-types";

export type ApiFailure = {
  ok: false;
  code: string;
  error: string;
  details?: unknown;
};

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

async function call<T>(
  path: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {
      cache: "no-store",
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      error: "Could not reach the server.",
    };
  }

  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; code?: string })
    | null;

  if (!res.ok) {
    return {
      ok: false,
      code: body?.code ?? `HTTP_${res.status}`,
      error: body?.error ?? `Request failed (${res.status})`,
      details: body?.details,
    };
  }
  return { ok: true, data: body as T };
}

export function fetchKitchenMenu(): Promise<
  ApiResult<{ categories: KitchenMenuCategory[] }>
> {
  return call("/kitchen/menu");
}

export function importKitchenMenu(input: {
  mode: "replace" | "merge";
  text?: string;
  categories?: {
    name: string;
    station?: string;
    items: { name: string; pricePence?: number; description?: string | null }[];
  }[];
}): Promise<
  ApiResult<{
    categories: KitchenMenuCategory[];
    importedCategories: number;
    importedItems: number;
  }>
> {
  return call("/kitchen/menu/import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function parseMenuImage(
  file: Blob
): Promise<
  ApiResult<{
    text: string;
    categories: unknown[];
    itemCount: number;
    categoryCount: number;
  }>
> {
  const form = new FormData();
  form.append("image", file, "menu.jpg");
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}/kitchen/menu/parse-image`, {
      method: "POST",
      credentials: "include",
      body: form,
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      error: "Could not reach the server.",
    };
  }
  const body = (await res.json().catch(() => null)) as
    | (Record<string, unknown> & { error?: string; code?: string })
    | null;
  if (!res.ok) {
    return {
      ok: false,
      code: body?.code ?? `HTTP_${res.status}`,
      error: body?.error ?? `Request failed (${res.status})`,
      details: body?.details,
    };
  }
  return { ok: true, data: body as {
    text: string;
    categories: unknown[];
    itemCount: number;
    categoryCount: number;
  } };
}

export function createKitchenMenuCategory(input: {
  name: string;
  station?: string;
}): Promise<ApiResult<{ category: KitchenMenuCategory }>> {
  return call("/kitchen/menu/categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createKitchenMenuItem(input: {
  categoryId: string;
  name: string;
  pricePence?: number;
  station?: string;
}): Promise<ApiResult<{ item: { id: string; name: string } }>> {
  return call("/kitchen/menu/items", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteKitchenMenuItem(
  id: string
): Promise<ApiResult<{ ok: boolean }>> {
  return call(`/kitchen/menu/items/${id}`, { method: "DELETE" });
}

export function reorderKitchenMenu(input: {
  categories?: { id: string; sortOrder: number; station?: string }[];
  items?: { id: string; sortOrder: number; categoryId?: string }[];
}): Promise<ApiResult<{ categories: KitchenMenuCategory[] }>> {
  return call("/kitchen/menu/reorder", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function fetchKitchenTickets(
  station?: string,
  status?: string
): Promise<ApiResult<{ tickets: KitchenTicket[] }>> {
  const params = new URLSearchParams();
  if (station) params.set("station", station);
  if (status) params.set("status", status);
  const qs = params.toString();
  return call(`/kitchen/tickets${qs ? `?${qs}` : ""}`);
}

export function createKitchenTicket(input: {
  station: string;
  tableLabel?: string;
  reservationId?: string;
  items: { menuItemId: string; qty: number; notes?: string }[];
}): Promise<ApiResult<KitchenTicket>> {
  return call("/kitchen/tickets", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKitchenTicketStatus(
  id: string,
  status: "in_progress" | "ready" | "served" | "void"
): Promise<ApiResult<KitchenTicket>> {
  return call(`/kitchen/tickets/${id}/status`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}

export type { KitchenMenuCategory, KitchenTicket };
