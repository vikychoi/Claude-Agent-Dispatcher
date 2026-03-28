import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.js';

export function SkillForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(id);

  const { data: skill } = useQuery({
    queryKey: ['skill', id],
    queryFn: () => api.getSkill(id!),
    enabled: isEdit,
  });

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');

  useEffect(() => {
    if (skill) {
      setName(skill.name);
      setDescription(skill.description);
      setContent(skill.content);
    }
  }, [skill]);

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.updateSkill(id!, { name, description, content })
        : api.createSkill({ name, description, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      navigate('/skills');
    },
  });

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{isEdit ? 'Edit Skill' : 'New Skill'}</h1>

      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Description</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Content (Markdown)</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={16}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
          />
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || !content || mutation.isPending}
            className="px-4 py-2 bg-gray-900 text-white rounded-md text-sm hover:bg-gray-800 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button onClick={() => navigate('/skills')} className="px-4 py-2 border border-gray-300 rounded-md text-sm">
            Cancel
          </button>
        </div>

        {mutation.isError && (
          <div className="text-red-600 text-sm">{(mutation.error as Error).message}</div>
        )}
      </div>
    </div>
  );
}
