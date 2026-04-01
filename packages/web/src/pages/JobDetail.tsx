import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';
import { api } from '../api.js';

const statusColors: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  failed: 'bg-red-100 text-red-700',
  terminated: 'bg-yellow-100 text-yellow-700',
};

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-6': 'Opus 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-haiku-4-5': 'Haiku 4.5',
};

interface LogEntry {
  id: number;
  source: string;
  line: string;
  created_at: string;
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: job } = useQuery({ queryKey: ['job', id], queryFn: () => api.getJob(id!), refetchInterval: 5000 });
  const { data: files } = useQuery({
    queryKey: ['job-files', id],
    queryFn: () => api.getJobFiles(id!),
    enabled: job?.status === 'terminated' || job?.status === 'failed',
  });

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [followUpPrompt, setFollowUpPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [tokens, setTokens] = useState<{ input_tokens: number; output_tokens: number }>({ input_tokens: 0, output_tokens: 0 });
  const [activity, setActivity] = useState<{ state: 'working' | 'idle'; turn: number }>({ state: 'working', turn: 0 });
  const [costUsd, setCostUsd] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!id) return;
    const socket = io({ transports: ['websocket'] });
    socketRef.current = socket;

    socket.emit('join-job', id);

    socket.on('logs-history', (history: LogEntry[]) => {
      setLogs(history);
    });

    socket.on('log', (log: LogEntry) => {
      setLogs((prev) => [...prev, log]);
    });

    socket.on('tokens', (data: { input_tokens: number; output_tokens: number }) => {
      setTokens(data);
    });

    socket.on('activity', (data: { state: 'working' | 'idle'; turn?: number }) => {
      setActivity({ state: data.state, turn: data.turn ?? 0 });
    });

    socket.on('cost', (data: { cost_usd: number }) => {
      setCostUsd(data.cost_usd);
    });

    socket.on('status', (data: { status: string }) => {
      queryClient.invalidateQueries({ queryKey: ['job', id] });
      if (data.status === 'failed' || data.status === 'terminated') {
        queryClient.invalidateQueries({ queryKey: ['job-files', id] });
      }
    });

    return () => {
      socket.emit('leave-job', id);
      socket.disconnect();
    };
  }, [id, queryClient]);


  const handleSendPrompt = async () => {
    if (!followUpPrompt || !id) return;
    setSending(true);
    try {
      await api.sendPrompt(id, followUpPrompt);
      setFollowUpPrompt('');
      setActivity(prev => ({ ...prev, state: 'working' }));
    } catch {
      // error silenced
    }
    setSending(false);
  };

  const handleTerminate = async () => {
    if (!id || !confirm('Terminate this job?')) return;
    await api.terminateJob(id);
    window.location.href = '/';
  };

  const handleDelete = async () => {
    if (!id || !confirm('Delete this job and its output files?')) return;
    await api.deleteJob(id);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    navigate('/');
  };

  const handleRestart = async () => {
    if (!id) return;
    const newJob = await api.restartJob(id);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    navigate(`/jobs/${newJob.id}`);
  };

  useEffect(() => {
    if (!job) return;
    if (job.input_tokens || job.output_tokens) {
      setTokens((prev) =>
        prev.input_tokens < job.input_tokens || prev.output_tokens < job.output_tokens
          ? { input_tokens: job.input_tokens, output_tokens: job.output_tokens }
          : prev
      );
    }
    if (job.cost_usd > costUsd) setCostUsd(job.cost_usd);
  }, [job]);

  if (!job) return <div>Loading...</div>;

  const isRunning = job.status === 'running';
  const isFinished = job.status === 'terminated' || job.status === 'failed';
  const totalTokens = tokens.input_tokens + tokens.output_tokens;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">Job</h1>
          {isRunning && activity.state === 'idle' ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">done</span>
          ) : isRunning ? (
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 animate-pulse">working</span>
          ) : (
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusColors[job.status] || ''}`}>
              {job.status}
            </span>
          )}
        </div>
        <div className="flex gap-3">
          {isRunning && (
            <button onClick={handleTerminate} className="px-4 py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50">
              Terminate
            </button>
          )}
          {job.status === 'failed' && (
            <button onClick={handleRestart} className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800">
              Restart
            </button>
          )}
          {!isRunning && (
            <button onClick={handleDelete} className="px-4 py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex flex-wrap gap-3 text-sm text-gray-600">
          <span className="px-2 py-0.5 bg-gray-100 rounded">{MODEL_LABELS[job.claude_config.model] || job.claude_config.model}</span>
          {job.claude_config.thinkingEffort && (
            <span className="px-2 py-0.5 bg-gray-100 rounded">thinking: {job.claude_config.thinkingEffort}</span>
          )}
          {job.claude_config.autoContinueCount > 0 && (
            <span className="px-2 py-0.5 bg-gray-100 rounded">auto-continue: {job.claude_config.autoContinueCount}x</span>
          )}
          {isRunning && job.claude_config.autoContinueCount > 0 && activity.turn > 0 && (
            <span className="px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded font-mono text-xs">
              turn {activity.turn} / {job.claude_config.autoContinueCount + 1}
            </span>
          )}
          {job.job_skills_snapshot.map((s) => (
            <span key={s.name} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded">{s.name}</span>
          ))}
          {totalTokens > 0 && (
            <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-mono text-xs">
              {tokens.input_tokens.toLocaleString()}↓ {tokens.output_tokens.toLocaleString()}↑
            </span>
          )}
          {costUsd > 0 && (
            <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded font-mono text-xs">
              ${costUsd.toFixed(4)}
            </span>
          )}
          {job.scheduled_for && (
            <span className="px-2 py-0.5 bg-orange-50 text-orange-700 rounded">Scheduled: {new Date(job.scheduled_for).toLocaleString()}</span>
          )}
          {job.started_at && <span>Started: {new Date(job.started_at).toLocaleString()}</span>}
          {job.finished_at && <span>Finished: {new Date(job.finished_at).toLocaleString()}</span>}
        </div>
        <p className="mt-3 text-sm whitespace-pre-wrap">{job.prompt}</p>
        {job.error && <p className="mt-3 text-sm text-red-600">{job.error}</p>}
      </div>

      <div className="bg-gray-900 rounded-lg p-4 max-h-[60vh] overflow-y-auto">
        <pre className="font-mono text-xs leading-relaxed">
          {logs.length === 0 ? (
            <span className="text-gray-500">Waiting for output...</span>
          ) : (
            logs.map((log) =>
              log.source === 'stdin' ? (
                <div
                  key={log.id ?? log.created_at}
                  className="bg-yellow-900/40 text-yellow-300 border-l-4 border-yellow-400 pl-3 py-1 my-2 rounded-r"
                >
                  <span className="text-yellow-500 font-bold text-[10px] uppercase tracking-wider">You</span>
                  <div className="mt-0.5">{log.line}</div>
                </div>
              ) : (
                <div
                  key={log.id ?? log.created_at}
                  className={log.source === 'stderr' ? 'text-red-400' : 'text-gray-200'}
                >
                  {log.line || '\u00A0'}
                </div>
              )
            )
          )}
          <div ref={logsEndRef} />
        </pre>
      </div>

      {isRunning && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <label className="block text-sm font-medium mb-2">Follow-up Prompt</label>
          <div className="flex gap-3">
            <textarea
              value={followUpPrompt}
              onChange={(e) => setFollowUpPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendPrompt(); } }}
              rows={2}
              placeholder="Send additional instructions to the running agent..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
            <button
              onClick={handleSendPrompt}
              disabled={!followUpPrompt || sending}
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50 self-end"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {isFinished && files && files.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <h2 className="text-sm font-medium mb-3">Artifacts ({files.length} files)</h2>
          <div className="space-y-1">
            {files.map((file) => {
              const fileName = file.path.split('/').pop() || file.path;
              const dirPath = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : null;
              const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
              return (
                <div key={file.path} className="flex items-center justify-between text-sm py-1 hover:bg-gray-50 px-2 rounded">
                  <div className="truncate mr-4">
                    {dirPath && <span className="text-gray-400 text-xs">{dirPath}/</span>}
                    <span className="font-medium">{fileName}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-500 shrink-0">
                    <span className="text-xs">{file.size < 1024 ? `${file.size} B` : `${(file.size / 1024).toFixed(1)} KB`}</span>
                    <a
                      href={`/api/jobs/${id}/files/${encodedPath}`}
                      download={fileName}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      Download
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
