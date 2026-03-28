const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  getAuthStatus: () => request<{ mode: string; configured: boolean }>('/settings/auth'),
  setAuth: (body: Record<string, string>) => request('/settings/auth', { method: 'PUT', body: JSON.stringify(body) }),
  deleteAuth: () => request('/settings/auth', { method: 'DELETE' }),

  getFileSizeLimit: () => request<{ limitMb: number }>('/settings/file-size-limit'),
  setFileSizeLimit: (limitMb: number) => request<{ limitMb: number }>('/settings/file-size-limit', { method: 'PUT', body: JSON.stringify({ limitMb }) }),

  getArtifactDepthLimit: () => request<{ depth: number }>('/settings/artifact-depth-limit'),
  setArtifactDepthLimit: (depth: number) => request<{ depth: number }>('/settings/artifact-depth-limit', { method: 'PUT', body: JSON.stringify({ depth }) }),

  getSkills: () => request<Array<{ id: string; name: string; description: string; content: string; created_at: string }>>('/skills'),
  getSkill: (id: string) => request<{ id: string; name: string; description: string; content: string }>(`/skills/${id}`),
  createSkill: (body: { name: string; description: string; content: string }) => request('/skills', { method: 'POST', body: JSON.stringify(body) }),
  updateSkill: (id: string, body: Record<string, string>) => request(`/skills/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSkill: (id: string) => request(`/skills/${id}`, { method: 'DELETE' }),

  getMcpServers: () => request<Array<{ id: string; name: string; type: string; command?: string; args: string[]; env: Record<string, string>; url?: string }>>('/mcp-servers'),
  getMcpServer: (id: string) => request<{ id: string; name: string; type: string; command?: string; args: string[]; env: Record<string, string>; url?: string }>(`/mcp-servers/${id}`),
  createMcpServer: (body: Record<string, unknown>) => request('/mcp-servers', { method: 'POST', body: JSON.stringify(body) }),
  updateMcpServer: (id: string, body: Record<string, unknown>) => request(`/mcp-servers/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMcpServer: (id: string) => request(`/mcp-servers/${id}`, { method: 'DELETE' }),
  testMcpServer: (body: Record<string, unknown>) => request<{ success: boolean; serverInfo?: { name: string; version: string }; tools?: Array<{ name: string; description?: string }>; error?: string; authRequired?: boolean; authServerUrl?: string; registrationEndpoint?: string }>('/mcp-servers/test', { method: 'POST', body: JSON.stringify(body) }),
  testMcpServerById: (id: string) => request<{ success: boolean; serverInfo?: { name: string; version: string }; tools?: Array<{ name: string; description?: string }>; error?: string; authRequired?: boolean; authServerUrl?: string; registrationEndpoint?: string }>(`/mcp-servers/${id}/test`, { method: 'POST' }),
  startMcpAuth: (id: string) => request<{ authorization_url: string }>(`/mcp-servers/${id}/auth/start`, { method: 'POST' }),

  getJobs: () => request<Array<{ id: string; status: string; prompt: string; claude_config: { model: string; thinkingEffort?: string }; input_tokens: number; output_tokens: number; cost_usd: number; created_at: string; started_at?: string; finished_at?: string }>>('/jobs'),
  getJobActivities: () => request<Record<string, string>>('/jobs/activity'),
  getJob: (id: string) => request<{ id: string; status: string; prompt: string; claude_md: string; claude_config: { model: string; thinkingEffort?: string }; job_skills_snapshot: Array<{ name: string }>; job_mcp_snapshot: unknown[]; input_tokens: number; output_tokens: number; cost_usd: number; error?: string; created_at: string; started_at?: string; finished_at?: string }>(`/jobs/${id}`),
  createJob: (body: Record<string, unknown>) => request<{ id: string }>('/jobs', { method: 'POST', body: JSON.stringify(body) }),
  createJobMultipart: async (formData: FormData): Promise<{ id: string }> => {
    const res = await fetch('/api/jobs', { method: 'POST', body: formData });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(body.error || res.statusText);
    }
    return res.json();
  },
  getJobLogs: (id: string) => request<Array<{ id: number; source: string; line: string; created_at: string }>>(`/jobs/${id}/logs`),
  sendPrompt: (id: string, prompt: string) => request(`/jobs/${id}/prompt`, { method: 'POST', body: JSON.stringify({ prompt }) }),
  terminateJob: (id: string) => request(`/jobs/${id}/terminate`, { method: 'POST' }),
  restartJob: (id: string) => request<{ id: string }>(`/jobs/${id}/restart`, { method: 'POST' }),
  deleteJob: (id: string) => request(`/jobs/${id}`, { method: 'DELETE' }),
  getJobFiles: (id: string) => request<Array<{ path: string; size: number; createdAt: string }>>(`/jobs/${id}/files`),
};
