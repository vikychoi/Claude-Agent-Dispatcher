import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export function Settings() {
  const queryClient = useQueryClient();
  const { data: auth, isLoading } = useQuery({ queryKey: ['auth'], queryFn: api.getAuthStatus });
  const { data: fileSizeLimit } = useQuery({ queryKey: ['file-size-limit'], queryFn: api.getFileSizeLimit });
  const [mode, setMode] = useState<'oauth' | 'api_key'>('oauth');
  const [credential, setCredential] = useState('');
  const [limitMb, setLimitMb] = useState<string>('');

  const setAuthMutation = useMutation({
    mutationFn: () => {
      const body = mode === 'oauth'
        ? { mode: 'oauth' as const, credentials: credential }
        : { mode: 'api_key' as const, key: credential };
      return api.setAuth(body as unknown as Record<string, string>);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      setCredential('');
    },
  });

  const deleteAuthMutation = useMutation({
    mutationFn: api.deleteAuth,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth'] }),
  });

  const fileSizeMutation = useMutation({
    mutationFn: (mb: number) => api.setFileSizeLimit(mb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['file-size-limit'] });
      setLimitMb('');
    },
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold mb-4">Authentication</h2>

        {auth?.configured ? (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-green-800 text-sm">
            Configured ({auth.mode === 'oauth' ? 'OAuth Credentials' : 'API Key'})
          </div>
        ) : (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
            Not configured. Set up authentication before submitting jobs.
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'oauth'} onChange={() => setMode('oauth')} />
              <span className="text-sm">OAuth Credentials</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === 'api_key'} onChange={() => setMode('api_key')} />
              <span className="text-sm">API Key</span>
            </label>
          </div>

          {mode === 'oauth' ? (
            <>
              <textarea
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                rows={6}
                placeholder='Paste contents of ~/.claude/.credentials.json'
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
              />
              <p className="text-xs text-gray-500">
                Run <code className="bg-gray-100 px-1 rounded">claude auth login</code>, then paste the full contents of <code className="bg-gray-100 px-1 rounded">~/.claude/.credentials.json</code>. Tokens will refresh automatically.
              </p>
            </>
          ) : (
            <input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="API key (sk-ant-...)"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          )}

          <div className="flex gap-3">
            <button
              onClick={() => setAuthMutation.mutate()}
              disabled={!credential || setAuthMutation.isPending}
              className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50"
            >
              {setAuthMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            {auth?.configured && (
              <button
                onClick={() => { if (confirm('Remove credential?')) deleteAuthMutation.mutate(); }}
                className="px-4 py-2 border border-red-300 text-red-600 rounded-md text-sm hover:bg-red-50"
              >
                Remove Credential
              </button>
            )}
          </div>

          {setAuthMutation.isError && (
            <div className="text-red-600 text-sm">{(setAuthMutation.error as Error).message}</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6 mt-6">
        <h2 className="text-lg font-semibold mb-4">File Upload Limit</h2>
        <p className="text-sm text-gray-600 mb-3">
          Current limit: <span className="font-medium">{fileSizeLimit?.limitMb ?? 50} MB</span> per file
        </p>
        <div className="flex gap-3 items-center">
          <input
            type="number"
            min={1}
            max={10000}
            value={limitMb}
            onChange={(e) => setLimitMb(e.target.value)}
            placeholder={String(fileSizeLimit?.limitMb ?? 50)}
            className="w-32 px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
          <span className="text-sm text-gray-500">MB</span>
          <button
            onClick={() => {
              const val = parseInt(limitMb, 10);
              if (val >= 1 && val <= 10000) fileSizeMutation.mutate(val);
            }}
            disabled={!limitMb || fileSizeMutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {fileSizeMutation.isPending ? 'Saving...' : 'Update'}
          </button>
        </div>
        {fileSizeMutation.isError && (
          <div className="text-red-600 text-sm mt-2">{(fileSizeMutation.error as Error).message}</div>
        )}
      </div>
    </div>
  );
}
