export class SupabaseRestError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = "SupabaseRestError";
    this.status = status;
    this.details = details;
  }
}

function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("SUPABASE_URL is not configured.");
  }
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured.");
  }

  return {
    url: url.replace(/\/$/, ""),
    serviceRoleKey,
  };
}

export async function supabaseTableRequest<T>(input: {
  table: string;
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  body?: unknown;
  single?: boolean;
}): Promise<T> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  const method = input.method ?? "GET";

  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(input.query ?? {})) {
    if (value === undefined) continue;
    queryParams.set(key, String(value));
  }

  const endpoint = `${url}/rest/v1/${input.table}${
    queryParams.size > 0 ? `?${queryParams.toString()}` : ""
  }`;

  const headers: Record<string, string> = {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: input.single ? "application/vnd.pgrst.object+json" : "application/json",
    ...input.headers,
  };

  if (input.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(endpoint, {
    method,
    headers,
    body: input.body !== undefined ? JSON.stringify(input.body) : undefined,
    cache: "no-store",
  });

  const rawText = await response.text();
  const hasBody = rawText.trim().length > 0;
  const parsedBody = hasBody ? safeJsonParse(rawText) : null;

  if (!response.ok) {
    throw new SupabaseRestError(
      `Supabase ${method} ${input.table} failed (${response.status})`,
      response.status,
      parsedBody ?? rawText,
    );
  }

  if (!hasBody) {
    return null as T;
  }

  if (parsedBody === null) {
    throw new Error(`Supabase ${method} ${input.table} returned non-JSON response.`);
  }

  return parsedBody as T;
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function sha256Hex(value: string) {
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(value))
    .then((buffer) => Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

export function extractDomainFromUrl(url: string | undefined) {
  if (!url) return "canvas.unknown.local";
  try {
    return new URL(url).hostname || "canvas.unknown.local";
  } catch {
    return "canvas.unknown.local";
  }
}

export function canonicalizeJson(value: unknown) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortObject(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    output[key] = sortObject(input[key]);
  }
  return output;
}
