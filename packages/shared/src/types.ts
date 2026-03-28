export type JobStatus = 'queued' | 'running' | 'failed' | 'terminated';

export type AuthMode = 'oauth' | 'api_key';

export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max';

export interface ClaudeConfig {
  model?: string;
  thinkingEffort?: ThinkingEffort;
}

export interface AuthConfig {
  mode: AuthMode;
  credential: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface OAuthMetadata {
  resource_url: string;
  authorization_server: string;
  client_id: string;
  client_secret?: string;
  token_endpoint: string;
  authorization_endpoint: string;
  registration_endpoint?: string;
  scopes?: string[];
}

export interface McpServer {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  oauth_access_token?: string;
  oauth_refresh_token?: string;
  oauth_metadata?: OAuthMetadata | null;
  has_oauth_token?: boolean;
  created_at: string;
  updated_at: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpTestResult {
  success: boolean;
  serverInfo?: { name: string; version: string; protocolVersion?: string };
  tools?: McpToolInfo[];
  error?: string;
  authRequired?: boolean;
  authServerUrl?: string;
  registrationEndpoint?: string;
}

export interface Job {
  id: string;
  status: JobStatus;
  prompt: string;
  claude_md: string;
  claude_config: ClaudeConfig & { model: string };
  job_skills_snapshot: SkillSnapshot[];
  job_mcp_snapshot: McpServerSnapshot[];
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  error?: string;
  created_at: string;
  started_at?: string;
  finished_at?: string;
}

export interface SkillSnapshot {
  id: string;
  name: string;
  content: string;
}

export interface McpServerSnapshot {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args: string[];
  env: Record<string, string>;
  url?: string;
  oauth_access_token?: string;
}

export interface TestMcpServerRequest {
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface LogLine {
  id: number;
  job_id: string;
  source: 'stdout' | 'stderr';
  line: string;
  created_at: string;
}

export interface JobFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface CreateJobRequest {
  prompt: string;
  claude_md: string;
  skill_ids: string[];
  mcp_server_ids: string[];
  claude_config?: ClaudeConfig;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  content: string;
}

export interface UpdateSkillRequest {
  name?: string;
  description?: string;
  content?: string;
}

export interface CreateMcpServerRequest {
  name: string;
  type: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface UpdateMcpServerRequest {
  name?: string;
  type?: 'stdio' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export type SetAuthRequest =
  | { mode: 'oauth'; credentials: string }
  | { mode: 'api_key'; key: string };

export interface AuthStatusResponse {
  mode: AuthMode;
  configured: boolean;
}

export interface ApiError {
  error: string;
  code: string;
}

export type JobEvent =
  | { type: 'log'; jobId: string; log: LogLine }
  | { type: 'status'; jobId: string; status: JobStatus; error?: string };
