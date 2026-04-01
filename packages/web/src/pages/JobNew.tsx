import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api.js';

const SUGGESTED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5',
];

const THINKING_OPTIONS = ['low', 'medium', 'high', 'max'] as const;

const DEFAULT_CLAUDE_MD = `# Project Instructions

Describe the project context and constraints here.
The agent will read this as its CLAUDE.md file.
`;

export function JobNew() {
  const navigate = useNavigate();
  const { data: skills } = useQuery({ queryKey: ['skills'], queryFn: api.getSkills });
  const { data: mcpServers } = useQuery({ queryKey: ['mcp-servers'], queryFn: api.getMcpServers });

  const [prompt, setPrompt] = useState('');
  const [claudeMd, setClaudeMd] = useState(DEFAULT_CLAUDE_MD);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set());
  const [model, setModel] = useState('claude-opus-4-6');
  const [thinking, setThinking] = useState<string>('max');
  const [autoContinueCount, setAutoContinueCount] = useState(0);
  const [autoContinuePrompt, setAutoContinuePrompt] = useState('continue');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [files, setFiles] = useState<FileList | null>(null);
  const [scheduleMode, setScheduleMode] = useState<'now' | 'delay' | 'datetime'>('now');
  const [delayMinutes, setDelayMinutes] = useState(30);
  const [scheduledDatetime, setScheduledDatetime] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);

  const mutation = useMutation({
    mutationFn: () => {
      const claude_config: Record<string, string> = { model, thinkingEffort: thinking };

      let scheduleFields: Record<string, unknown> = {};
      if (scheduleMode === 'delay' && delayMinutes > 0) {
        scheduleFields = { delay_minutes: delayMinutes };
      } else if (scheduleMode === 'datetime' && scheduledDatetime) {
        // Convert naive datetime + timezone to UTC ISO string
        const dtStr = scheduledDatetime; // "YYYY-MM-DDThh:mm"
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
          timeZoneName: 'longOffset',
        }).formatToParts(new Date());
        // Get the UTC offset for the target timezone
        const offsetPart = formatted.find(p => p.type === 'timeZoneName')?.value || '';
        // offsetPart is like "GMT+05:30" or "GMT-04:00"
        const offset = offsetPart.replace('GMT', '') || '+00:00';
        const isoWithTz = `${dtStr}:00${offset}`;
        scheduleFields = { scheduled_for: new Date(isoWithTz).toISOString() };
      }

      const data: Record<string, unknown> = {
        prompt,
        claude_md: claudeMd,
        skill_ids: Array.from(selectedSkills),
        mcp_server_ids: Array.from(selectedMcp),
        claude_config,
        ...(autoContinueCount > 0 && { auto_continue_count: autoContinueCount }),
        ...(autoContinueCount > 0 && autoContinuePrompt && { auto_continue_prompt: autoContinuePrompt }),
        ...scheduleFields,
      };
      if (files && files.length > 0) {
        const formData = new FormData();
        formData.append('data', JSON.stringify(data));
        for (let i = 0; i < files.length; i++) {
          formData.append('files', files[i]);
        }
        return api.createJobMultipart(formData);
      }
      return api.createJob(data);
    },
    onSuccess: (data) => navigate(`/jobs/${data.id}`),
  });

  const toggleSkill = (id: string) => {
    const next = new Set(selectedSkills);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedSkills(next);
  };

  const toggleMcp = (id: string) => {
    const next = new Set(selectedMcp);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedMcp(next);
  };

  const settingsSummary = [
    model !== 'claude-opus-4-6' ? model : null,
    thinking !== 'max' ? `thinking: ${thinking}` : null,
    autoContinueCount > 0 ? `auto-continue: ${autoContinueCount}x` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold mb-6">New Job</h1>

      <div className="space-y-6">
        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={6}
              placeholder="Describe the task for the agent..."
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">CLAUDE.md</label>
            <textarea
              value={claudeMd}
              onChange={(e) => setClaudeMd(e.target.value)}
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">File Attachments</label>
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(e.target.files)}
              className="w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border file:border-gray-300 file:text-sm file:bg-white file:text-gray-700 hover:file:bg-gray-50"
            />
            {files && files.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
            )}
          </div>
        </div>

        {(skills?.length || mcpServers?.length) ? (
          <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
            {skills && skills.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2">Skills</label>
                <div className="space-y-2">
                  {skills.map((skill) => (
                    <label key={skill.id} className="flex items-start gap-2 p-2 rounded hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedSkills.has(skill.id)}
                        onChange={() => toggleSkill(skill.id)}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium">{skill.name}</div>
                        {skill.description && <div className="text-xs text-gray-500">{skill.description}</div>}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {mcpServers && mcpServers.length > 0 && (
              <div>
                <label className="block text-sm font-medium mb-2">MCP Servers</label>
                <div className="space-y-2">
                  {mcpServers.map((server) => (
                    <label key={server.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedMcp.has(server.id)}
                        onChange={() => toggleMcp(server.id)}
                      />
                      <span className="text-sm">{server.name}</span>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs">{server.type}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <div className="bg-white rounded-lg border border-gray-200">
          <button
            onClick={() => setSettingsOpen(!settingsOpen)}
            className="w-full px-6 py-4 flex items-center justify-between text-left"
            type="button"
          >
            <span className="text-sm font-medium">Agent Settings (optional)</span>
            <div className="flex items-center gap-3">
              {!settingsOpen && settingsSummary && (
                <span className="text-xs text-gray-500">{settingsSummary}</span>
              )}
              <span className="text-gray-400">{settingsOpen ? '−' : '+'}</span>
            </div>
          </button>
          {settingsOpen && (
            <div className="px-6 pb-6 space-y-4 border-t border-gray-100 pt-4">
              <div>
                <label className="block text-sm font-medium mb-1">Model</label>
                <input
                  list="model-suggestions"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. claude-sonnet-4-6"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <datalist id="model-suggestions">
                  {SUGGESTED_MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Thinking Effort</label>
                <div className="flex gap-4">
                  {THINKING_OPTIONS.map((opt) => (
                    <label key={opt} className="flex items-center gap-2">
                      <input type="radio" checked={thinking === opt} onChange={() => setThinking(opt)} />
                      <span className="text-sm capitalize">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Auto-Continue</label>
                <p className="text-xs text-gray-500 mb-2">Automatically send a follow-up prompt N times after the agent completes each turn.</p>
                <div className="flex gap-3 items-start">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Count</label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      value={autoContinueCount}
                      onChange={(e) => setAutoContinueCount(Math.max(0, Math.min(50, parseInt(e.target.value, 10) || 0)))}
                      className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs text-gray-500 mb-1">Prompt</label>
                    <input
                      type="text"
                      value={autoContinuePrompt}
                      onChange={(e) => setAutoContinuePrompt(e.target.value)}
                      disabled={autoContinueCount === 0}
                      placeholder="continue"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
          <h2 className="text-sm font-medium">Schedule</h2>
          <div className="flex gap-4">
            {(['now', 'delay', 'datetime'] as const).map((mode) => (
              <label key={mode} className="flex items-center gap-2">
                <input type="radio" checked={scheduleMode === mode} onChange={() => setScheduleMode(mode)} />
                <span className="text-sm">
                  {mode === 'now' ? 'Run now' : mode === 'delay' ? 'Run in...' : 'Run at...'}
                </span>
              </label>
            ))}
          </div>

          {scheduleMode === 'delay' && (
            <div className="flex gap-3 items-center">
              <input
                type="number"
                min={1}
                max={10080}
                value={delayMinutes}
                onChange={(e) => setDelayMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <span className="text-sm text-gray-500">minutes from now</span>
            </div>
          )}

          {scheduleMode === 'datetime' && (
            <div className="flex gap-3 items-start flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Date & Time</label>
                <input
                  type="datetime-local"
                  value={scheduledDatetime}
                  onChange={(e) => setScheduledDatetime(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Timezone</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm max-w-xs"
                >
                  {Intl.supportedValuesOf('timeZone').map((tz) => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => mutation.mutate()}
            disabled={!prompt || mutation.isPending}
            className="px-6 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Submitting...' : scheduleMode === 'now' ? 'Submit Job' : 'Schedule Job'}
          </button>
          <button onClick={() => navigate('/')} className="px-4 py-2 border border-gray-300 rounded-md text-sm">
            Cancel
          </button>
        </div>

        {mutation.isError && <div className="text-red-600 text-sm">{(mutation.error as Error).message}</div>}
      </div>
    </div>
  );
}
