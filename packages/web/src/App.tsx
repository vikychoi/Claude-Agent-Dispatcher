import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { JobList } from './pages/JobList.js';
import { JobNew } from './pages/JobNew.js';
import { JobDetail } from './pages/JobDetail.js';
import { Settings } from './pages/Settings.js';
import { SkillList } from './pages/SkillList.js';
import { SkillForm } from './pages/SkillForm.js';
import { McpServerList } from './pages/McpServerList.js';
import { McpServerForm } from './pages/McpServerForm.js';

const navItems = [
  { path: '/', label: 'Jobs' },
  { path: '/skills', label: 'Skills' },
  { path: '/mcp-servers', label: 'MCP Servers' },
  { path: '/settings', label: 'Settings' },
];

export function App() {
  const location = useLocation();

  return (
    <div className="min-h-screen">
      <nav className="bg-white border-b border-gray-200 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-8">
          <Link to="/" className="text-lg font-bold text-gray-900">Taskshed</Link>
          <div className="flex gap-4">
            {navItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                className={`text-sm px-3 py-1.5 rounded-md ${
                  location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path))
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<JobList />} />
          <Route path="/jobs/new" element={<JobNew />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/skills" element={<SkillList />} />
          <Route path="/skills/new" element={<SkillForm />} />
          <Route path="/skills/:id/edit" element={<SkillForm />} />
          <Route path="/mcp-servers" element={<McpServerList />} />
          <Route path="/mcp-servers/new" element={<McpServerForm />} />
          <Route path="/mcp-servers/:id/edit" element={<McpServerForm />} />
        </Routes>
      </main>
    </div>
  );
}
