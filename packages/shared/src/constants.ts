import type { ClaudeConfig } from './types.js';

export const QUEUE_NAME = 'jobs';

export const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  model: 'claude-opus-4-6',
  thinkingEffort: 'max',
};

export const CLAUDE_MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
};

export const THINKING_EFFORTS = ['low', 'medium', 'high', 'max'] as const;

export const JOB_STATUSES = ['queued', 'running', 'failed', 'terminated'] as const;
