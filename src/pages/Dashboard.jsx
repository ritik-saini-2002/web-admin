import { useState, useEffect } from 'react';
import { Users, Building2, ShieldCheck, FolderTree, Activity, TrendingUp, User, Briefcase } from 'lucide-react';
import { listRecords, COL_USERS, COL_COMPANIES, checkHealth } from '../api/pocketbase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function Dashboard() {
  const { auth, hasPermission } = useAuth();
  const canViewAll = hasPermission('view_all_users');

  const [stats, setStats] = useState({ users: 0, active: 0, companies: 0, roles: [], depts: [], serverUp: false });
  const [loading, setLoading] = useState(true);
  const [roleData, setRoleData] = useState([]);
  const [companyData, setCompanyData] = useState([]);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    try {
      const health = await checkHealth();

      if (canViewAll) {
        // Admin/Manager view — full stats
        const [usersRes, companiesRes] = await Promise.all([
          listRecords(COL_USERS, { perPage: 1 }),
          listRecords(COL_COMPANIES, { perPage: 200 }),
        ]);

        const allUsers = await listRecords(COL_USERS, { perPage: 200 });
        const users = allUsers.items || [];

        const roleCounts = {};
        let activeCount = 0;
        users.forEach(u => {
          const role = u.role || 'Unknown';
          roleCounts[role] = (roleCounts[role] || 0) + 1;
          if (u.isActive !== false) activeCount++;
        });

        setRoleData(Object.entries(roleCounts).map(([name, value]) => ({ name, value })));

        const companies = companiesRes.items || [];
        setCompanyData(companies.map(c => ({
          name: c.originalName || c.sanitizedName,
          users: c.totalUsers || 0,
          active: c.activeUsers || 0,
        })));

        const uniqueRoles = [...new Set(users.map(u => u.role).filter(Boolean))];
        const uniqueDepts = [...new Set(users.map(u => u.department).filter(Boolean))];

        setStats({
          users: usersRes.totalItems || users.length,
          active: activeCount,
          companies: companiesRes.totalItems || companies.length,
          roles: uniqueRoles,
          depts: uniqueDepts,
          serverUp: health,
        });
      } else {
        // Regular user — limited stats
        setStats({
          users: 0,
          active: 0,
          companies: 0,
          roles: [],
          depts: [],
          serverUp: health,
        });
      }
    } catch (e) {
      console.error('Dashboard load failed:', e);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner spinner-lg" />
        <span>Loading dashboard...</span>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Welcome, {auth?.name || 'User'}</h1>
          <p>{canViewAll ? 'Overview of your IT Connect platform' : `${auth?.role?.replace(/_/g, ' ')} — ${auth?.department || 'Dashboard'}`}</p>
        </div>
        <div className="page-header-actions">
          <div className={`badge ${stats.serverUp ? 'badge-emerald' : 'badge-rose'}`}>
            <span className="badge-dot" />
            PocketBase {stats.serverUp ? 'Online' : 'Offline'}
          </div>
        </div>
      </div>

      {/* User profile card for non-admin users */}
      {!canViewAll && (
        <div className="stats-grid" style={{ marginBottom: 28 }}>
          <div className="stat-card blue">
            <div className="stat-info">
              <h3>Your Role</h3>
              <div className="stat-value" style={{ fontSize: '1.3rem' }}>{auth?.role?.replace(/_/g, ' ')}</div>
              <span className="stat-sub">{auth?.designation || 'Team Member'}</span>
            </div>
            <div className="stat-icon blue"><ShieldCheck size={24} /></div>
          </div>
          <div className="stat-card emerald">
            <div className="stat-info">
              <h3>Company</h3>
              <div className="stat-value" style={{ fontSize: '1.3rem' }}>{auth?.companyName || '—'}</div>
              <span className="stat-sub">{auth?.department || '—'}</span>
            </div>
            <div className="stat-icon emerald"><Building2 size={24} /></div>
          </div>
          <div className="stat-card amber">
            <div className="stat-info">
              <h3>Permissions</h3>
              <div className="stat-value">{auth?.permissions?.length || 0}</div>
              <span className="stat-sub">assigned to your role</span>
            </div>
            <div className="stat-icon amber"><Briefcase size={24} /></div>
          </div>
        </div>
      )}

      {canViewAll && (
        <>
          {/* Stats Cards */}
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-info">
                <h3>Total Users</h3>
                <div className="stat-value">{stats.users}</div>
                <span className="stat-sub">{stats.active} active</span>
              </div>
              <div className="stat-icon blue"><Users size={24} /></div>
            </div>
            <div className="stat-card emerald">
              <div className="stat-info">
                <h3>Active Users</h3>
                <div className="stat-value">{stats.active}</div>
                <span className="stat-sub">{stats.users > 0 ? Math.round(stats.active / stats.users * 100) : 0}% of total</span>
              </div>
              <div className="stat-icon emerald"><Activity size={24} /></div>
            </div>
            <div className="stat-card amber">
              <div className="stat-info">
                <h3>Companies</h3>
                <div className="stat-value">{stats.companies}</div>
                <span className="stat-sub">{stats.depts.length} departments</span>
              </div>
              <div className="stat-icon amber"><Building2 size={24} /></div>
            </div>
            <div className="stat-card purple">
              <div className="stat-info">
                <h3>Roles</h3>
                <div className="stat-value">{stats.roles.length}</div>
                <span className="stat-sub">Unique roles defined</span>
              </div>
              <div className="stat-icon purple"><ShieldCheck size={24} /></div>
            </div>
          </div>

          {/* Charts */}
          <div className="detail-grid">
            <div className="detail-card" style={{ minHeight: 340 }}>
              <h3><TrendingUp size={18} /> Users by Role</h3>
              {roleData.length > 0 ? (
                <ResponsiveContainer width="100%" height={270}>
                  <PieChart>
                    <Pie
                      data={roleData}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={4}
                      dataKey="value"
                      label={({ name, value }) => `${name} (${value})`}
                    >
                      {roleData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#1c2030', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f3f7' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state"><p>No role data available</p></div>
              )}
            </div>

            <div className="detail-card" style={{ minHeight: 340 }}>
              <h3><Building2 size={18} /> Users by Company</h3>
              {companyData.length > 0 ? (
                <ResponsiveContainer width="100%" height={270}>
                  <BarChart data={companyData} barSize={32}>
                    <XAxis dataKey="name" tick={{ fill: '#8b92a5', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#8b92a5', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: '#1c2030', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f3f7' }}
                    />
                    <Bar dataKey="users" fill="#3b82f6" radius={[6, 6, 0, 0]} name="Total" />
                    <Bar dataKey="active" fill="#10b981" radius={[6, 6, 0, 0]} name="Active" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state"><p>No company data available</p></div>
              )}
            </div>
          </div>

          {/* Quick Info */}
          <div className="detail-grid">
            <div className="detail-card">
              <h3><ShieldCheck size={18} /> Active Roles</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {stats.roles.length > 0 ? stats.roles.map(r => (
                  <span key={r} className="badge badge-blue">{r}</span>
                )) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No roles found</span>}
              </div>
            </div>
            <div className="detail-card">
              <h3><FolderTree size={18} /> Departments</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {stats.depts.length > 0 ? stats.depts.map(d => (
                  <span key={d} className="badge badge-emerald">{d}</span>
                )) : <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>No departments found</span>}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Permissions list for all users */}
      {!canViewAll && auth?.permissions?.length > 0 && (
        <div className="detail-card">
          <h3><ShieldCheck size={18} /> Your Permissions</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {auth.permissions.map(p => (
              <span key={p} className="badge badge-blue">{p.replace(/_/g, ' ')}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
