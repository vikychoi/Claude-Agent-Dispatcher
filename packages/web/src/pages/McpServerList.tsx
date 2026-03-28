import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export function McpServerList() {
  const queryClient = useQueryClient();
  const { data: servers, isLoading } = useQuery({ queryKey: ['mcp-servers'], queryFn: api.getMcpServers });

  const deleteMutation = useMutation({
    mutationFn: api.deleteMcpServer,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-servers'] }),
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">MCP Servers</h1>
        <Link to="/mcp-servers/new" className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800">
          Add Server
        </Link>
      </div>

      {!servers?.length ? (
        <p className="text-gray-500">No MCP servers configured.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {servers.map((server) => (
                <tr key={server.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-sm">{server.name}</td>
                  <td className="px-4 py-3 text-sm">
                    <span className="px-2 py-0.5 rounded-full bg-gray-100 text-xs">{server.type}</span>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <Link to={`/mcp-servers/${server.id}/edit`} className="text-blue-600 hover:underline">Edit</Link>
                      <button
                        onClick={() => { if (confirm('Delete this server?')) deleteMutation.mutate(server.id); }}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                    {deleteMutation.isError && deleteMutation.variables === server.id && (
                      <div className="text-red-600 text-xs mt-1">{(deleteMutation.error as Error).message}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
