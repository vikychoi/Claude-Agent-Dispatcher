import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

interface TestResult {
  success: boolean;
  serverInfo?: { name: string; version: string };
  tools?: Array<{ name: string; description?: string }>;
  error?: string;
  authRequired?: boolean;
  registrationEndpoint?: string;
}

export function McpServerForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(id);

  const { data: server } = useQuery({
    queryKey: ['mcp-server', id],
    queryFn: () => api.getMcpServer(id!),
    enabled: isEdit,
  });

  const [name, setName] = useState('');
  const [type, setType] = useState<'stdio' | 'sse'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState<string[]>(['']);
  const [envPairs, setEnvPairs] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
  const [url, setUrl] = useState('');

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    if (server) {
      setName(server.name);
      setType(server.type as 'stdio' | 'sse');
      setCommand(server.command || '');
      setArgs(server.args.length ? server.args : ['']);
      setUrl(server.url || '');
      const pairs = Object.entries(server.env).map(([key, value]) => ({ key, value }));
      setEnvPairs(pairs.length ? pairs : [{ key: '', value: '' }]);
    }
  }, [server]);

  const handleOAuthMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === 'mcp-oauth-complete') {
      setIsAuthenticating(false);
      window.removeEventListener('message', handleOAuthMessage);
      if (event.data.success && id) {
        queryClient.invalidateQueries({ queryKey: ['mcp-server', id] });
        handleTestById();
      }
    }
  }, [id, queryClient]);

  useEffect(() => {
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [handleOAuthMessage]);

  const mutation = useMutation({
    mutationFn: () => {
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key) env[pair.key] = pair.value;
      }
      const body = {
        name,
        type,
        command: type === 'stdio' ? command : undefined,
        args: type === 'stdio' ? args.filter(Boolean) : undefined,
        env: Object.keys(env).length ? env : undefined,
        url: type === 'sse' ? url : undefined,
      };
      return isEdit ? api.updateMcpServer(id!, body) : api.createMcpServer(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      navigate('/mcp-servers');
    },
  });

  const handleTestUnsaved = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key) env[pair.key] = pair.value;
      }
      const result = await api.testMcpServer({
        type,
        command: type === 'stdio' ? command : undefined,
        args: type === 'stdio' ? args.filter(Boolean) : undefined,
        env: Object.keys(env).length ? env : undefined,
        url: type === 'sse' ? url : undefined,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message });
    }
    setIsTesting(false);
  };

  const handleTestById = async () => {
    if (!id) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.testMcpServerById(id);
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: (err as Error).message });
    }
    setIsTesting(false);
  };

  const handleTest = () => {
    if (isEdit) {
      handleTestById();
    } else {
      handleTestUnsaved();
    }
  };

  const handleAuthenticate = async () => {
    if (!id) return;
    setIsAuthenticating(true);
    try {
      const { authorization_url } = await api.startMcpAuth(id);
      window.addEventListener('message', handleOAuthMessage);
      const popup = window.open(authorization_url, 'mcp-oauth', 'width=600,height=700');
      if (!popup) {
        setIsAuthenticating(false);
        setTestResult({ success: false, error: 'Popup blocked. Please allow popups and try again.' });
        return;
      }
      setTimeout(() => {
        setIsAuthenticating(false);
        window.removeEventListener('message', handleOAuthMessage);
      }, 300000);
    } catch (err) {
      setIsAuthenticating(false);
      setTestResult({ success: false, error: `Auth start failed: ${(err as Error).message}` });
    }
  };

  const canTest = type === 'stdio' ? Boolean(command) : Boolean(url);
  const hasOAuthToken = Boolean((server as Record<string, unknown> | undefined)?.['has_oauth_token']);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{isEdit ? 'Edit MCP Server' : 'Add MCP Server'}</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Type</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="radio" checked={type === 'stdio'} onChange={() => setType('stdio')} />
              <span className="text-sm">stdio</span>
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={type === 'sse'} onChange={() => setType('sse')} />
              <span className="text-sm">sse</span>
            </label>
          </div>
        </div>

        {type === 'stdio' ? (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Command</label>
              <input value={command} onChange={(e) => setCommand(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Arguments</label>
              {args.map((arg, i) => (
                <div key={i} className="flex gap-2 mb-2">
                  <input
                    value={arg}
                    onChange={(e) => { const next = [...args]; next[i] = e.target.value; setArgs(next); }}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                  <button onClick={() => setArgs(args.filter((_, j) => j !== i))} className="text-red-500 text-sm px-2" type="button">X</button>
                </div>
              ))}
              <button onClick={() => setArgs([...args, ''])} className="text-blue-600 text-sm" type="button">+ Add Argument</button>
            </div>
          </>
        ) : (
          <div>
            <label className="block text-sm font-medium mb-1">URL</label>
            <div className="flex items-center gap-2">
              <input value={url} onChange={(e) => setUrl(e.target.value)} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm" />
              {hasOAuthToken && (
                <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-medium shrink-0">Authenticated</span>
              )}
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Environment Variables</label>
          {envPairs.map((pair, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input
                placeholder="Key"
                value={pair.key}
                onChange={(e) => { const next = [...envPairs]; next[i] = { ...pair, key: e.target.value }; setEnvPairs(next); }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <input
                placeholder="Value"
                type="password"
                value={pair.value}
                onChange={(e) => { const next = [...envPairs]; next[i] = { ...pair, value: e.target.value }; setEnvPairs(next); }}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
              <button onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))} className="text-red-500 text-sm px-2" type="button">X</button>
            </div>
          ))}
          <button onClick={() => setEnvPairs([...envPairs, { key: '', value: '' }])} className="text-blue-600 text-sm" type="button">+ Add Variable</button>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || mutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button
            onClick={handleTest}
            disabled={!canTest || isTesting}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          <button onClick={() => navigate('/mcp-servers')} className="px-4 py-2 border border-gray-300 rounded-md text-sm">
            Cancel
          </button>
        </div>

        {mutation.isError && <div className="text-red-600 text-sm">{(mutation.error as Error).message}</div>}

        {testResult && (
          <div className={`rounded-lg border p-4 mt-4 ${
            testResult.success
              ? 'border-green-300 bg-green-50'
              : testResult.authRequired
              ? 'border-yellow-300 bg-yellow-50'
              : 'border-red-300 bg-red-50'
          }`}>
            {testResult.success && (
              <>
                {testResult.serverInfo && (
                  <div className="text-sm font-medium text-green-800 mb-2">
                    Connected to {testResult.serverInfo.name} v{testResult.serverInfo.version}
                  </div>
                )}
                {testResult.tools && testResult.tools.length > 0 ? (
                  <div>
                    <div className="text-xs text-green-700 font-medium mb-1">
                      {testResult.tools.length} tool{testResult.tools.length !== 1 ? 's' : ''} available
                    </div>
                    <div className="space-y-1">
                      {testResult.tools.map((tool) => (
                        <div key={tool.name} className="text-sm text-green-900 bg-green-100 rounded px-2 py-1">
                          <span className="font-mono font-medium">{tool.name}</span>
                          {tool.description && <span className="text-green-700 ml-2">- {tool.description}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-green-700">Connected successfully. No tools exposed.</div>
                )}
              </>
            )}

            {testResult.authRequired && (
              <div>
                <div className="text-sm font-medium text-yellow-800 mb-2">Authentication Required</div>
                <p className="text-sm text-yellow-700 mb-3">
                  This server requires OAuth authentication to connect.
                </p>
                {isEdit && testResult.registrationEndpoint ? (
                  <button
                    onClick={handleAuthenticate}
                    disabled={isAuthenticating}
                    className="px-4 py-2 bg-yellow-600 text-white rounded-md text-sm hover:bg-yellow-700 disabled:opacity-50"
                  >
                    {isAuthenticating ? 'Authenticating...' : 'Authenticate'}
                  </button>
                ) : isEdit ? (
                  <p className="text-xs text-yellow-600">
                    This auth server does not support dynamic client registration. Configure credentials manually in environment variables.
                  </p>
                ) : (
                  <p className="text-xs text-yellow-600">Save the server first, then authenticate.</p>
                )}
                {testResult.error && <p className="text-xs text-yellow-600 mt-2">{testResult.error}</p>}
              </div>
            )}

            {!testResult.success && !testResult.authRequired && (
              <div className="text-sm text-red-700">{testResult.error || 'Connection failed'}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
