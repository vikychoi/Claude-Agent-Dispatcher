import { Router } from 'express';
import type { CreateSkillRequest, UpdateSkillRequest, Skill } from '@taskshed/shared';
import { query } from '../db.js';

export const skillsRouter = Router();

skillsRouter.get('/', async (_req, res) => {
  const result = await query<Skill>('SELECT * FROM skills ORDER BY name');
  res.json(result.rows);
});

skillsRouter.post('/', async (req, res) => {
  const body = req.body as CreateSkillRequest;
  if (!body.name || !body.content) {
    res.status(400).json({ error: 'Name and content are required', code: 'VALIDATION_ERROR' });
    return;
  }
  const result = await query<Skill>(
    `INSERT INTO skills (name, description, content) VALUES ($1, $2, $3) RETURNING *`,
    [body.name, body.description || '', body.content]
  );
  res.status(201).json(result.rows[0]);
});

skillsRouter.get('/:id', async (req, res) => {
  const result = await query<Skill>('SELECT * FROM skills WHERE id = $1', [req.params['id']]);
  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Skill not found', code: 'NOT_FOUND' });
    return;
  }
  res.json(result.rows[0]);
});

skillsRouter.put('/:id', async (req, res) => {
  const body = req.body as UpdateSkillRequest;
  const existing = await query<Skill>('SELECT * FROM skills WHERE id = $1', [req.params['id']]);
  if (existing.rows.length === 0) {
    res.status(404).json({ error: 'Skill not found', code: 'NOT_FOUND' });
    return;
  }
  const current = existing.rows[0];
  const result = await query<Skill>(
    `UPDATE skills SET name = $1, description = $2, content = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
    [body.name ?? current.name, body.description ?? current.description, body.content ?? current.content, req.params['id']]
  );
  res.json(result.rows[0]);
});

skillsRouter.delete('/:id', async (req, res) => {
  const running = await query(
    `SELECT 1 FROM jobs WHERE status = 'running' AND job_skills_snapshot @> $1::jsonb`,
    [JSON.stringify([{ id: req.params['id'] }])]
  );
  if (running.rows.length > 0) {
    res.status(409).json({ error: 'Skill is referenced by a running job', code: 'CONFLICT' });
    return;
  }
  await query('DELETE FROM skills WHERE id = $1', [req.params['id']]);
  res.status(204).end();
});
