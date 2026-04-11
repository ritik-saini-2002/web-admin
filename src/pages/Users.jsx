import { useState, useEffect, useCallback } from 'react';
import { Search, Plus, UserCog, Trash2, ToggleLeft, ToggleRight, RefreshCw, ChevronUp, ChevronDown, Eye } from 'lucide-react';
import { listRecords, COL_USERS, createUserFull, toggleUserActive, changeUserRole, deleteUserFull, updateRecord } from '../api/pocketbase';
import { ALL_ROLES, ADMIN_ASSIGNABLE_ROLES, getRoleBadgeColor } from '../utils/permissions';
import { getInitials, formatDate, parseJsonSafe } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [showView, setShowView] = useState(null);
  const [showEdit, setShowEdit] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const { addToast } = useToast();

  const perPage = 20;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const filters = [];
      if (search) {
        // Escape single quotes in search input
        const s = search.replace(/'/g, "\\'");
        filters.push(`(name~'${s}' || email~'${s}' || role~'${s}' || department~'${s}')`);
      }
      if (roleFilter) filters.push(`role='${roleFilter}'`);
      // Use isActive!=true for "inactive" to catch false, null, and unset values
      if (statusFilter === 'active') filters.push('isActive=true');
      if (statusFilter === 'inactive') filters.push('isActive!=true');

      const res = await listRecords(COL_USERS, {
        page,
        perPage,
        filter: filters.length ? filters.join(' && ') : undefined,
        sort: `${sortDir === 'desc' ? '-' : ''}${sortField}`,
      });
      setUsers(res.items || []);
      setTotal(res.totalItems || 0);
    } catch (e) {
      console.error('Failed to load users:', e);
      addToast('Failed to load users: ' + (e.message || 'Unknown error'), 'error');
      setUsers([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [search, roleFilter, statusFilter, page, sortField, sortDir, addToast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  async function handleToggleActive(user) {
    setActionLoading(user.id);
    try {
      await toggleUserActive(user.id, !user.isActive);
      addToast(`User ${user.isActive ? 'deactivated' : 'activated'}`, 'success');
      loadUsers();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleDelete(user) {
    if (!confirm(`Delete user "${user.name || user.email}"? This cannot be undone.`)) return;
    setActionLoading(user.id);
    try {
      await deleteUserFull(user.id);
      addToast('User deleted', 'success');
      loadUsers();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>User Management</h1>
          <p>{total} users total</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-outline" onClick={loadUsers}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            <Plus size={16} /> Create User
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div className="search-box" style={{ minWidth: 260 }}>
              <Search size={16} />
              <input
                placeholder="Search users..."
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <select className="select" style={{ width: 160 }} value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1); }}>
              <option value="">All Roles</option>
              {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="select" style={{ width: 140 }} value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div className="table-toolbar-right">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Page {page} of {totalPages || 1}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading users...</span></div>
        ) : users.length === 0 ? (
          <div className="empty-state">
            <Users size={48} />
            <h3>No users found</h3>
            <p>Try adjusting your filters or create a new user.</p>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => handleSort('name')} className={sortField === 'name' ? 'sorted' : ''}>User <SortIcon field="name" /></th>
                    <th onClick={() => handleSort('role')} className={sortField === 'role' ? 'sorted' : ''}>Role <SortIcon field="role" /></th>
                    <th onClick={() => handleSort('companyName')} className={sortField === 'companyName' ? 'sorted' : ''}>Company <SortIcon field="companyName" /></th>
                    <th onClick={() => handleSort('department')} className={sortField === 'department' ? 'sorted' : ''}>Department <SortIcon field="department" /></th>
                    <th>Status</th>
                    <th onClick={() => handleSort('created')} className={sortField === 'created' ? 'sorted' : ''}>Created <SortIcon field="created" /></th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(user => (
                    <tr key={user.id}>
                      <td>
                        <div className="user-cell">
                          <div className="user-avatar">{getInitials(user.name)}</div>
                          <div className="user-details">
                            <span className="user-name">{user.name || '—'}</span>
                            <span className="user-email">{user.email}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className={`badge badge-${getRoleBadgeColor(user.role)}`}>{user.role || '—'}</span></td>
                      <td>{user.companyName || '—'}</td>
                      <td>{user.department || '—'}</td>
                      <td>
                        <span className="status-active">
                          <span className={`status-dot ${user.isActive !== false ? 'online' : 'offline'}`} />
                          {user.isActive !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>{formatDate(user.created)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-ghost btn-icon btn-sm" title="View" onClick={() => setShowView(user)}>
                            <Eye size={15} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Edit Role" onClick={() => setShowEdit(user)}>
                            <UserCog size={15} />
                          </button>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title={user.isActive !== false ? 'Deactivate' : 'Activate'}
                            onClick={() => handleToggleActive(user)}
                            disabled={actionLoading === user.id}
                          >
                            {user.isActive !== false ? <ToggleRight size={15} style={{ color: 'var(--accent-emerald)' }} /> : <ToggleLeft size={15} />}
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" title="Delete" onClick={() => handleDelete(user)} disabled={actionLoading === user.id}>
                            <Trash2 size={15} style={{ color: 'var(--accent-rose)' }} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span className="table-pagination-info">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
              </span>
              <div className="table-pagination-btns">
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create User Modal */}
      <CreateUserModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); loadUsers(); }} />

      {/* View User Modal */}
      {showView && <ViewUserModal user={showView} onClose={() => setShowView(null)} />}

      {/* Edit Role Modal */}
      {showEdit && <EditRoleModal user={showEdit} onClose={() => setShowEdit(null)} onSaved={() => { setShowEdit(null); loadUsers(); }} />}
    </div>
  );
}

// ── Create User Modal ──────────────────────────────────────────────────

function CreateUserModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', password: '', name: '', role: 'Employee', companyName: '', department: '', designation: '', phoneNumber: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { addToast } = useToast();

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.email || !form.password || !form.name || !form.companyName || !form.department) {
      setError('Please fill all required fields'); return;
    }
    setLoading(true); setError('');
    try {
      await createUserFull(form);
      addToast('User created successfully!', 'success');
      setForm({ email: '', password: '', name: '', role: 'Employee', companyName: '', department: '', designation: '', phoneNumber: '' });
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create New User"
      large
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={loading}>
            {loading ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Creating...</> : <><Plus size={16} /> Create User</>}
          </button>
        </>
      }
    >
      {error && <div className="login-error" style={{ marginBottom: 16 }}>{error}</div>}
      <form className="form-grid" onSubmit={handleCreate}>
        <div className="input-group">
          <label>Full Name *</label>
          <input className="input" value={form.name} onChange={e => update('name', e.target.value)} placeholder="John Doe" />
        </div>
        <div className="input-group">
          <label>Email *</label>
          <input className="input" type="email" value={form.email} onChange={e => update('email', e.target.value)} placeholder="john@company.com" />
        </div>
        <div className="input-group">
          <label>Password *</label>
          <input className="input" type="password" value={form.password} onChange={e => update('password', e.target.value)} placeholder="Min 8 characters" />
        </div>
        <div className="input-group">
          <label>Phone</label>
          <input className="input" value={form.phoneNumber} onChange={e => update('phoneNumber', e.target.value)} placeholder="+91 9876543210" />
        </div>
        <div className="input-group">
          <label>Company *</label>
          <input className="input" value={form.companyName} onChange={e => update('companyName', e.target.value)} placeholder="Company Name" />
        </div>
        <div className="input-group">
          <label>Department *</label>
          <input className="input" value={form.department} onChange={e => update('department', e.target.value)} placeholder="Engineering" />
        </div>
        <div className="input-group">
          <label>Designation</label>
          <input className="input" value={form.designation} onChange={e => update('designation', e.target.value)} placeholder="Software Engineer" />
        </div>
        <div className="input-group">
          <label>Role</label>
          <select className="select" value={form.role} onChange={e => update('role', e.target.value)}>
            {ADMIN_ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </form>
    </Modal>
  );
}

// ── View User Modal ────────────────────────────────────────────────────

function ViewUserModal({ user, onClose }) {
  const profile = parseJsonSafe(user.profile) || {};
  const workStats = parseJsonSafe(user.workStats) || {};
  const issues = parseJsonSafe(user.issues) || {};
  let permissions = [];
  try { permissions = JSON.parse(user.permissions || '[]'); } catch { }

  return (
    <Modal open={true} onClose={onClose} title={`User: ${user.name || user.email}`} large>
      <div className="detail-grid" style={{ marginBottom: 0 }}>
        <div className="detail-card" style={{ background: 'var(--bg-deep)' }}>
          <h3>Profile</h3>
          <div className="detail-row"><span className="detail-label">Name</span><span className="detail-value">{user.name}</span></div>
          <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{user.email}</span></div>
          <div className="detail-row"><span className="detail-label">Phone</span><span className="detail-value">{profile.phoneNumber || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Designation</span><span className="detail-value">{user.designation || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Employee ID</span><span className="detail-value">{profile.employeeId || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Address</span><span className="detail-value">{profile.address || '—'}</span></div>
        </div>
        <div className="detail-card" style={{ background: 'var(--bg-deep)' }}>
          <h3>Organization</h3>
          <div className="detail-row"><span className="detail-label">Role</span><span className={`badge badge-${getRoleBadgeColor(user.role)}`}>{user.role || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Company</span><span className="detail-value">{user.companyName || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Department</span><span className="detail-value">{user.department || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Status</span><span className="detail-value"><span className="status-active"><span className={`status-dot ${user.isActive !== false ? 'online' : 'offline'}`} />{user.isActive !== false ? 'Active' : 'Inactive'}</span></span></div>
          <div className="detail-row"><span className="detail-label">Doc Path</span><span className="detail-value" style={{ fontSize: '0.72rem' }}>{user.documentPath || '—'}</span></div>
        </div>
      </div>
      {permissions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: '0.88rem', marginBottom: 10 }}>Permissions ({permissions.length})</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {permissions.map(p => <span key={p} className="badge badge-blue">{p}</span>)}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Edit Role Modal ────────────────────────────────────────────────────

function EditRoleModal({ user, onClose, onSaved }) {
  const [role, setRole] = useState(user.role || 'Employee');
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  async function handleSave() {
    setLoading(true);
    try {
      await changeUserRole(user.id, role);
      addToast(`Role changed to ${role}`, 'success');
      onSaved();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Change Role — ${user.name || user.email}`}
      footer={
        <>
          <button className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={loading}>
            {loading ? 'Saving...' : 'Save Role'}
          </button>
        </>
      }
    >
      <div className="input-group">
        <label>Current Role</label>
        <span className={`badge badge-${getRoleBadgeColor(user.role)}`} style={{ alignSelf: 'flex-start' }}>{user.role || '—'}</span>
      </div>
      <div className="input-group" style={{ marginTop: 16 }}>
        <label>New Role</label>
        <select className="select" value={role} onChange={e => setRole(e.target.value)}>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
    </Modal>
  );
}
