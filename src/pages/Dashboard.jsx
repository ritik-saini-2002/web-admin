import { useState, useEffect, useCallback } from 'react';
import {
  Users, Building2, ShieldCheck, FolderTree, Activity, TrendingUp,
  Briefcase, Monitor, Award, Clock, CheckCircle, AlertCircle,
  ArrowRight, Star, FileText, UserCheck
} from 'lucide-react';
import { listRecords, COL_USERS, COL_COMPANIES, checkHealth } from '../api/pocketbase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../context/AuthContext';
import { formatPermission } from '../utils/permissions';
import { parseJsonSafe } from '../utils/helpers';
import { useNavigate } from 'react-router-dom';

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#ec4899'];

export default function Dashboard() {
  const { auth, hasPermission } = useAuth();
  const navigate = useNavigate();
  const canViewAll = hasPermission('view_all_users');
  const canViewTeam = hasPermission('view_team_users');
  const [stats, setStats] = useState({ users: 0, active: 0, companies: 0, roles: [], depts: [], serverUp: false });
  const [loading, setLoading] = useState(true);
  const [roleData, setRoleData] = useState([]);
  const [companyData, setCompanyData] = useState([]);
  const [teamUsers, setTeamUsers] = useState([]);

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const health = await checkHealth();

      if (canViewAll) {
        // Admin/HR view — full stats
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
      } else if (canViewTeam && auth?.department) {
        // Manager/Team Lead — department scoped
        const deptUsers = await listRecords(COL_USERS, {
          perPage: 200,
          filter: `department='${auth.department}'`,
        });
        const users = deptUsers.items || [];
        setTeamUsers(users);

        let activeCount = 0;
        const roleCounts = {};
        users.forEach(u => {
          if (u.isActive !== false) activeCount++;
          const r = u.role || 'Unknown';
          roleCounts[r] = (roleCounts[r] || 0) + 1;
        });

        setRoleData(Object.entries(roleCounts).map(([name, value]) => ({ name, value })));

        setStats({
          users: users.length,
          active: activeCount,
          companies: 0,
          roles: [...new Set(users.map(u => u.role).filter(Boolean))],
          depts: [auth.department],
          serverUp: health,
        });
      } else {
        // Regular user
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
  }, [auth, canViewAll, canViewTeam]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const workStats = parseJsonSafe(auth?.workStats) || {};
  const issues = parseJsonSafe(auth?.issues) || {};

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
          <p>
            {canViewAll
              ? 'Overview of your IT Connect platform'
              : canViewTeam
              ? `${auth?.department} Department Dashboard`
              : `${auth?.role?.replace(/_/g, ' ')} — ${auth?.department || 'Dashboard'}`
            }
          </p>
        </div>
        <div className="page-header-actions">
          <div className={`badge ${stats.serverUp ? 'badge-emerald' : 'badge-rose'}`}>
            <span className="badge-dot" />
            PocketBase {stats.serverUp ? 'Online' : 'Offline'}
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
           ADMIN / HR VIEW — Full platform overview
           ══════════════════════════════════════════════════════════════════ */}
      {canViewAll && (
        <>
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

          {/* Admin Quick Actions */}
          <div className="dashboard-quick-actions">
            <h2><ArrowRight size={18} /> Quick Actions</h2>
            <div className="quick-action-grid">
              <button className="quick-action-btn blue" onClick={() => navigate('/users')}>
                <Users size={20} />
                <span>Manage Users</span>
              </button>
              <button className="quick-action-btn purple" onClick={() => navigate('/roles')}>
                <ShieldCheck size={20} />
                <span>Manage Roles</span>
              </button>
              <button className="quick-action-btn amber" onClick={() => navigate('/companies')}>
                <Building2 size={20} />
                <span>Companies</span>
              </button>
              <button className="quick-action-btn emerald" onClick={() => navigate('/database')}>
                <Activity size={20} />
                <span>Database</span>
              </button>
              {hasPermission('remote_access') && (
                <button className="quick-action-btn cyan" onClick={() => navigate('/remote')}>
                  <Monitor size={20} />
                  <span>Remote Control</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
           MANAGER / TEAM LEAD VIEW — Department scoped
           ══════════════════════════════════════════════════════════════════ */}
      {!canViewAll && canViewTeam && (
        <>
          <div className="stats-grid">
            <div className="stat-card blue">
              <div className="stat-info">
                <h3>Team Members</h3>
                <div className="stat-value">{stats.users}</div>
                <span className="stat-sub">{auth?.department}</span>
              </div>
              <div className="stat-icon blue"><Users size={24} /></div>
            </div>
            <div className="stat-card emerald">
              <div className="stat-info">
                <h3>Active Members</h3>
                <div className="stat-value">{stats.active}</div>
                <span className="stat-sub">{stats.users > 0 ? Math.round(stats.active / stats.users * 100) : 0}% active</span>
              </div>
              <div className="stat-icon emerald"><UserCheck size={24} /></div>
            </div>
            <div className="stat-card purple">
              <div className="stat-info">
                <h3>Roles in Team</h3>
                <div className="stat-value">{stats.roles.length}</div>
                <span className="stat-sub">unique roles</span>
              </div>
              <div className="stat-icon purple"><ShieldCheck size={24} /></div>
            </div>
            <div className="stat-card amber">
              <div className="stat-info">
                <h3>Your Role</h3>
                <div className="stat-value" style={{ fontSize: '1.3rem' }}>{auth?.role?.replace(/_/g, ' ')}</div>
                <span className="stat-sub">{auth?.designation || 'Team Lead'}</span>
              </div>
              <div className="stat-icon amber"><Award size={24} /></div>
            </div>
          </div>

          {/* Team role distribution */}
          {roleData.length > 0 && (
            <div className="detail-grid">
              <div className="detail-card" style={{ minHeight: 300 }}>
                <h3><TrendingUp size={18} /> Team by Role</h3>
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie data={roleData} cx="50%" cy="50%" innerRadius={45} outerRadius={85} paddingAngle={4} dataKey="value" label={({ name, value }) => `${name} (${value})`}>
                      {roleData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: '#1c2030', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, color: '#f1f3f7' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="detail-card">
                <h3><Users size={18} /> Team Members</h3>
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {teamUsers.slice(0, 20).map(u => (
                    <div key={u.id} className="team-member-row">
                      <span className={`status-dot ${u.isActive !== false ? 'online' : 'offline'}`} />
                      <span style={{ flex: 1, fontSize: '0.85rem' }}>{u.name || u.email}</span>
                      <span className="badge badge-blue" style={{ fontSize: '0.68rem' }}>{u.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Manager Quick Actions */}
          <div className="dashboard-quick-actions">
            <h2><ArrowRight size={18} /> Quick Actions</h2>
            <div className="quick-action-grid">
              <button className="quick-action-btn blue" onClick={() => navigate('/users')}>
                <Users size={20} />
                <span>View Team</span>
              </button>
              <button className="quick-action-btn purple" onClick={() => navigate('/profile')}>
                <Briefcase size={20} />
                <span>My Profile</span>
              </button>
              {hasPermission('remote_access') && (
                <button className="quick-action-btn cyan" onClick={() => navigate('/remote')}>
                  <Monitor size={20} />
                  <span>Remote Control</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
           EMPLOYEE / INTERN VIEW — Personal dashboard
           ══════════════════════════════════════════════════════════════════ */}
      {!canViewAll && !canViewTeam && (
        <>
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

          {/* Work Stats Cards */}
          <div className="detail-grid">
            <div className="detail-card">
              <h3><Activity size={18} /> Work Stats</h3>
              <div className="profile-stats-grid" style={{ marginTop: 12 }}>
                <div className="profile-stat">
                  <div className="profile-stat-value">{workStats.completedProjects || 0}</div>
                  <div className="profile-stat-label">Completed Projects</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{workStats.activeProjects || 0}</div>
                  <div className="profile-stat-label">Active Projects</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{workStats.completedTasks || 0}</div>
                  <div className="profile-stat-label">Tasks Done</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{workStats.pendingTasks || 0}</div>
                  <div className="profile-stat-label">Pending</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{workStats.totalWorkingHours || 0}h</div>
                  <div className="profile-stat-label">Hours</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">
                    <Star size={14} style={{ color: 'var(--accent-amber)', marginRight: 4 }} />
                    {workStats.avgPerformanceRating?.toFixed(1) || '0.0'}
                  </div>
                  <div className="profile-stat-label">Rating</div>
                </div>
              </div>
            </div>
            <div className="detail-card">
              <h3><AlertCircle size={18} /> Issues</h3>
              <div className="profile-stats-grid" style={{ marginTop: 12 }}>
                <div className="profile-stat">
                  <div className="profile-stat-value" style={{ color: 'var(--accent-blue)' }}>{issues.totalComplaints || 0}</div>
                  <div className="profile-stat-label">Total</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value" style={{ color: 'var(--accent-emerald)' }}>
                    <CheckCircle size={14} style={{ marginRight: 4 }} />
                    {issues.resolvedComplaints || 0}
                  </div>
                  <div className="profile-stat-label">Resolved</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value" style={{ color: 'var(--accent-amber)' }}>{issues.pendingComplaints || 0}</div>
                  <div className="profile-stat-label">Pending</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Actions for Employee */}
          <div className="dashboard-quick-actions">
            <h2><ArrowRight size={18} /> Quick Actions</h2>
            <div className="quick-action-grid">
              <button className="quick-action-btn blue" onClick={() => navigate('/profile')}>
                <Briefcase size={20} />
                <span>My Profile</span>
              </button>
              {hasPermission('remote_access') && (
                <button className="quick-action-btn cyan" onClick={() => navigate('/remote')}>
                  <Monitor size={20} />
                  <span>Remote Control</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {/* Permissions list for non-admin users */}
      {!canViewAll && auth?.permissions?.length > 0 && (
        <div className="detail-card" style={{ marginTop: 20 }}>
          <h3><ShieldCheck size={18} /> Your Permissions</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {auth.permissions.map(p => (
              <span key={p} className="badge badge-blue">{formatPermission(p)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
