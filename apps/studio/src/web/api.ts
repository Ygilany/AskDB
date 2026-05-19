import type {
  AskRequest,
  AskResponse,
  RagIndexResponse,
  RagQueryRequest,
  RagQueryResponse,
  SaveConceptsRequest,
  SaveTableRequest,
  SaveTenantPolicyRequest,
  StudioErrorDto,
  StudioRagStatusDto,
  StudioWorkspaceDto,
  SuggestRequest,
  SuggestResponse,
  SuggestTenantPolicyResponse,
} from "@/shared/api";

export async function getWorkspace(): Promise<StudioWorkspaceDto> {
  return api<StudioWorkspaceDto>("/api/workspace");
}

export async function saveTable(tableId: string, request: SaveTableRequest): Promise<StudioWorkspaceDto> {
  return api<StudioWorkspaceDto>(`/api/tables/${encodeURIComponent(tableId)}`, {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function saveConcepts(request: SaveConceptsRequest): Promise<StudioWorkspaceDto> {
  return api<StudioWorkspaceDto>("/api/concepts", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function saveTenantPolicy(request: SaveTenantPolicyRequest): Promise<StudioWorkspaceDto> {
  return api<StudioWorkspaceDto>("/api/tenant-policy", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function suggestTenantPolicy(): Promise<SuggestTenantPolicyResponse> {
  return api<SuggestTenantPolicyResponse>("/api/suggest-tenant-policy", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function suggest(request: SuggestRequest): Promise<SuggestResponse> {
  return api<SuggestResponse>("/api/suggest", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function getRagStatus(): Promise<StudioRagStatusDto> {
  return api<StudioRagStatusDto>("/api/rag/status");
}

export async function buildRagIndex(): Promise<RagIndexResponse> {
  return api<RagIndexResponse>("/api/rag/index", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function queryRag(request: RagQueryRequest): Promise<RagQueryResponse> {
  return api<RagQueryResponse>("/api/rag/query", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

export async function ask(request: AskRequest): Promise<AskResponse> {
  return api<AskResponse>("/api/ask", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });
  const body = (await response.json()) as T | StudioErrorDto;
  if (!response.ok) {
    const message = isStudioError(body)
      ? body.error.message
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return body as T;
}

function isStudioError(value: unknown): value is StudioErrorDto {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: { message?: unknown } }).error?.message === "string"
  );
}
