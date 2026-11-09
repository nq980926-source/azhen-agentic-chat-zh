import { hasMcpOAuthAccess } from "./mcp/oauth";
import { t } from "./i18n";
import {
  mcpServerAuthProblem,
  mcpServerEndpointProblem,
  type McpKnownToolSettings,
  type McpServerSettings,
} from "./mcp/settings";
import { localMcpToolName } from "./mcp/tools";

export interface McpTestButtonState {
  label: string;
  busyLabel: string;
  problem: string;
  needsOAuthSignIn: boolean;
}

export function formatMcpToolApprovalDescription(localName: string, tool: McpKnownToolSettings): string {
  return `${localName}${tool.readOnlyHint ? ` · ${t("mcp.readOnlyHint")}` : ""}`;
}

export function formatMcpServerSummary(server: McpServerSettings, endpointProblem: string): string {
  const status = t(server.enabled ? "mcp.enabled" : "mcp.disabled");
  const auth = formatMcpAuthType(server);
  const toolLabel = t(server.knownTools.length === 1 ? "mcp.toolOne" : "mcp.tools");
  const tools =
    server.knownTools.length > 0
      ? t("mcp.discovered", { count: server.knownTools.length, label: toolLabel })
      : t("mcp.noneDiscovered");
  const endpoint = endpointProblem || server.url || t("mcp.noEndpoint");
  return `${endpoint} · ${status} · ${auth} · ${tools}`;
}

export function formatMcpAuthType(server: McpServerSettings): string {
  if (server.authType === "none") return t("mcp.noAuth");
  if (server.authType === "bearer") return t(server.authHeaderValue ? "mcp.bearerSet" : "mcp.bearerMissing");
  if (server.authType === "header") {
    return server.authHeaderName && server.authHeaderValue
      ? t("mcp.header", { name: server.authHeaderName })
      : t("mcp.headerIncomplete");
  }
  return t(hasMcpOAuthAccess(server) ? "mcp.oauthAuthenticated" : "mcp.oauthNotAuthenticated");
}

export function mcpEndpointProblem(url: string): string {
  return mcpServerEndpointProblem(url);
}

export function mcpAuthProblem(server: McpServerSettings): string {
  return mcpServerAuthProblem(server);
}

export function mcpTestButtonState(server: McpServerSettings): McpTestButtonState {
  const hasPendingOAuth = Boolean(server.pendingOAuthChallenge && server.pendingOAuthResourceUrl);
  const needsOAuthSignIn = (server.authType === "oauth" && !hasMcpOAuthAccess(server)) || hasPendingOAuth;
  const problem = mcpEndpointProblem(server.url) || (needsOAuthSignIn ? "" : mcpAuthProblem(server));
  return {
    label: t(needsOAuthSignIn ? "mcp.authenticateTest" : "mcp.testConnection"),
    busyLabel: t(needsOAuthSignIn ? "mcp.authenticating" : "mcp.testing"),
    problem,
    needsOAuthSignIn,
  };
}

export function formatMcpToolSample(toolNames: string[]): string {
  const sample = toolNames.slice(0, 5).join(", ");
  return sample ? ` (${sample})` : "";
}

export function mcpSecretIds(server: McpServerSettings): string[] {
  return [
    server.authHeaderValueSecretId,
    server.oauth.clientSecretSecretId,
    server.oauth.accessTokenSecretId,
    server.oauth.refreshTokenSecretId,
  ].filter(Boolean);
}

export function mcpKnownToolLocalName(server: McpServerSettings, tool: McpKnownToolSettings): string {
  return tool.localName || localMcpToolName(server.id, tool.name);
}

export function mcpCredentialResourceChanged(previousUrl: string, nextUrl: string): boolean {
  const previous = mcpCredentialResourceState(previousUrl);
  const next = mcpCredentialResourceState(nextUrl);
  if (previous.kind === "placeholder" && next.kind === "resource") return false;
  if (previous.kind === "resource" && next.kind === "resource") return previous.value !== next.value;
  return previous.kind !== next.kind;
}

export function mcpCredentialResourceState(value: string): { kind: "placeholder" | "invalid" | "resource"; value?: string } {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "https://") return { kind: "placeholder" };
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return { kind: "invalid" };
    parsed.hash = "";
    parsed.search = "";
    if (parsed.pathname === "/") parsed.pathname = "";
    return { kind: "resource", value: parsed.toString().replace(/\/$/, "") };
  } catch {
    return { kind: "invalid" };
  }
}
