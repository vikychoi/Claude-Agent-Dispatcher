import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

function duration(start?: string, end?: string): string {
  if (!start) return '-';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const secs = Math.floor((e - s) / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  return `${mins}m ${secs % 60}s`;
}

export function JobList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: auth } = useQuery({ queryKey: ['auth'], queryFn: api.getAuthStatus });
  const { data: jobs, isLoading } = useQuery({ queryKey: ['jobs'], queryFn: api.getJobs, refetchInterval: 5000 });
  const { data: activities } = useQuery({ queryKey: ['job-activities'], queryFn: api.getJobActivities, refetchInterval: 5000 });

  const handleRestart = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    const newJob = await api.restartJob(jobId);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
    navigate(`/jobs/${newJob.id}`);
  };

  const handleTerminate = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    if (!confirm('Terminate this job?')) return;
    await api.terminateJob(jobId);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  const handleDelete = async (e: React.MouseEvent, jobId: string) => {
    e.preventDefault();
    if (!confirm('Delete this job and its output files?')) return;
    await api.deleteJob(jobId);
    queryClient.invalidateQueries({ queryKey: ['jobs'] });
  };

  return (
    <div>
      {auth && !auth.configured && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          Authentication not configured. <Link to="/settings" className="underline font-medium">Set up credentials</Link> before submitting jobs.
        </div>
      )}

      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Jobs</h1>
        <Link to="/jobs/new" className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800">
          New Job
        </Link>
      </div>

      {isLoading ? (
        <div>Loading...</div>
      ) : !jobs?.length ? (
        <p className="text-gray-500">No jobs yet.</p>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Link key={job.id} to={`/jobs/${job.id}`} className="block bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-400 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  {job.status === 'running' && activities?.[job.id] === 'idle' ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">done</span>
                  ) : job.status === 'queued' && job.scheduled_for && new Date(job.scheduled_for) > new Date() ? (
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700">scheduled</span>
                  ) : (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[job.status] || ''}`}>
                      {job.status}
                    </span>
                  )}
                  <span className="text-xs text-gray-500">{MODEL_LABELS[job.claude_config.model] || job.claude_config.model}</span>
                  {job.claude_config.thinkingEffort && (
                    <span className="text-xs text-gray-400">thinking: {job.claude_config.thinkingEffort}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {job.cost_usd > 0 && (
                    <span className="text-xs font-mono text-emerald-600">${job.cost_usd.toFixed(4)}</span>
                  )}
                  <span className="text-xs text-gray-400">{duration(job.started_at, job.finished_at)}</span>
                  {job.status === 'running' && (
                    <button onClick={(e) => handleTerminate(e, job.id)} className="px-2 py-0.5 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50">
                      Terminate
                    </button>
                  )}
                  {job.status === 'failed' && (
                    <button onClick={(e) => handleRestart(e, job.id)} className="px-2 py-0.5 text-xs border border-gray-700 text-gray-700 rounded hover:bg-gray-100">
                      Restart
                    </button>
                  )}
                  {job.status !== 'running' && (
                    <button onClick={(e) => handleDelete(e, job.id)} className="px-2 py-0.5 text-xs border border-gray-300 text-gray-500 rounded hover:bg-gray-100">
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-700 truncate">{job.prompt}</p>
              <p className="text-xs text-gray-400 mt-1">
                {job.scheduled_for && job.status === 'queued'
                  ? `Scheduled: ${new Date(job.scheduled_for).toLocaleString()}`
                  : new Date(job.created_at).toLocaleString()
                }
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
