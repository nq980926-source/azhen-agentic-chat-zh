import type { WebFetcher, WebHttpRequest, WebHttpResponse } from "./web-fetch";

/** Fixed official endpoints: credentials must never be sent to the target page. */
export function deepSeekRequest(operation: "search" | "fetch", body: Record<string, unknown>, apiKey: string): WebHttpRequest {
  if (!apiKey.trim()) throw new Error("DeepSeek: configure a search API key.");
  return {
    url: `https://api.deepseek.com/v1/tools/${operation}`,
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function parseDeepSeekResponse(response: WebHttpResponse): unknown {
  const messages: Record<number, string> = {
    0: "connection failed or timed out", 400: "invalid parameters", 401: "invalid API key",
    402: "insufficient account balance", 403: "page access denied", 404: "page unavailable",
    408: "request timed out", 429: "rate limit exceeded", 504: "upstream timed out",
  };
  if (response.status !== 200) {
    throw new Error(`DeepSeek: ${messages[response.status] ?? "request failed"} (HTTP ${response.status}).`);
  }
  try { return JSON.parse(response.text); } catch { throw new Error("DeepSeek: invalid JSON response."); }
}

/** Never echo transport exceptions, which can contain request headers. */
export async function requestDeepSeek(fetcher: WebFetcher, operation: "search" | "fetch", body: Record<string, unknown>, apiKey: string, signal?: AbortSignal): Promise<WebHttpResponse> {
  const request = deepSeekRequest(operation, body, apiKey);
  try { return await fetcher(request, signal); } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error("DeepSeek: connection failed or timed out.");
  }
}
