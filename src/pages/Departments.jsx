import { useState, useEffect } from 'react';
import { FolderTree, Users, RefreshCw, Building2 } from 'lucide-react';
import { listRecords, COL_USERS } from '../api/pocketbase';
import { useToast } from '../context/ToastContext';

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const { addToast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await listRecords(COL_USERS, { perPage: 500 });
      const users = res.items || [];
      const deptMap = {};
      users.forEach(u => {
        const dept = u.department || 'Unassigned';
        const company = u.companyName || 'Unknown';
        const key = `${company}::${dept}`;
        if (!deptMap[key]) {
          deptMap[key] = { name: dept, company, users: [], active: 0, total: 0, roles: new Set() };
        }
        deptMap[key].users.push(u);
        deptMap[key].total++;
        if (u.isActive !== false) deptMap[key].active++;
        if (u.role) deptMap[key].roles.add(u.role);
      });
      const depts = Object.values(deptMap).map(d => ({
        ...d, roles: [...d.roles],
      }));
      depts.sort((a, b) => a.company.localeCompare(b.company) || a.name.localeCompare(b.name));
      setDepartments(depts);
    } catch (e) {
      addToast('Failed to load departments: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading departments...</span></div>;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Department Management</h1>
          <p>{departments.length} departments across all companies</p>
        </div>
        <button className="btn btn-outline" onClick={load}><RefreshCw size={16} /> Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {departments.map((dept, i) => (
          <div
            key={i}
            className="card"
            style={{ cursor: 'pointer', border: selected === i ? '1px solid var(--accent-blue)' : undefined }}
            onClick={() => setSelected(selected === i ? null : i)}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="stat-icon emerald" style={{ width: 42, height: 42 }}>
                  <FolderTree size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{dept.name}</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Building2 size={12} /> {dept.company}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>{dept.total}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Total Users</div>
              </div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>{dept.active}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Active</div>
              </div>
              <div>
                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--accent-amber)' }}>{dept.roles.length}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Roles</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {dept.roles.map(r => <span key={r} className="badge badge-blue" style={{ fontSize: '0.68rem' }}>{r}</span>)}
            </div>

            {selected === i && (
              <div style={{ marginTop: 14, borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
                <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>Users in Department</h4>
                {dept.users.map(u => (
                  <div key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                    <span className={`status-dot ${u.isActive !== false ? 'online' : 'offline'}`} />
                    <span style={{ flex: 1, fontSize: '0.82rem' }}>{u.name || u.email}</span>
                    <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>{u.role}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {departments.length === 0 && (
        <div className="empty-state">
          <FolderTree size={48} />
          <h3>No departments found</h3>
          <p>Departments are auto-created when users are registered with a department.</p>
        </div>
      )}
    </div>
  );
}
