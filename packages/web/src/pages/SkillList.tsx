import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export function SkillList() {
  const queryClient = useQueryClient();
  const { data: skills, isLoading } = useQuery({ queryKey: ['skills'], queryFn: api.getSkills });

  const deleteMutation = useMutation({
    mutationFn: api.deleteSkill,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills'] }),
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Skills</h1>
        <Link to="/skills/new" className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800">
          New Skill
        </Link>
      </div>

      {!skills?.length ? (
        <p className="text-gray-500">No skills yet.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-left text-sm text-gray-500">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 w-32">Actions</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-sm">{skill.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 truncate max-w-xs">{skill.description}</td>
                  <td className="px-4 py-3 text-sm text-gray-500">{new Date(skill.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex gap-2">
                      <Link to={`/skills/${skill.id}/edit`} className="text-blue-600 hover:underline">Edit</Link>
                      <button
                        onClick={() => { if (confirm('Delete this skill?')) deleteMutation.mutate(skill.id); }}
                        className="text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </div>
                    {deleteMutation.isError && deleteMutation.variables === skill.id && (
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
