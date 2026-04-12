import { useState, useEffect, useCallback } from 'react';
import {
  User, Mail, Phone, MapPin, Building2, ShieldCheck, Briefcase,
  Save, RefreshCw, Clock, Award, FolderOpen, AlertCircle,
  Activity, CheckCircle, XCircle, Users, Star, Edit3
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getUserRecord, updateUserProfile } from '../api/pocketbase';
import { getRoleBadgeColor, PERMISSION_GROUPS, formatPermission } from '../utils/permissions';
import { parseJsonSafe, formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';

export default function ProfilePage() {
  const { auth, updateLocalSession, refreshSession } = useAuth();
  const { addToast } = useToast();
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Editable fields
  const [form, setForm] = useState({
    name: '',
    phoneNumber: '',
    address: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelation: '',
  });

  const loadProfile = useCallback(async () => {
    if (!auth?.userId && !auth?.isSuperuser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (auth.isSuperuser) {
        // Superusers don't have a user record — use session data
        setUserData(null);
        setLoading(false);
        return;
      }
      const record = await getUserRecord(auth.userId, auth.token);
      setUserData(record);
      const profile = parseJsonSafe(record.profile) || {};
      setForm({
        name: record.name || '',
        phoneNumber: profile.phoneNumber || '',
        address: profile.address || '',
        emergencyContactName: profile.emergencyContactName || '',
        emergencyContactPhone: profile.emergencyContactPhone || '',
        emergencyContactRelation: profile.emergencyContactRelation || '',
      });
    } catch (e) {
      addToast('Failed to load profile: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [auth?.userId, auth?.token, auth?.isSuperuser, addToast]);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
  }

  async function handleSave() {
    if (!auth?.userId) return;
    setSaving(true);
    try {
      const currentProfile = parseJsonSafe(userData?.profile) || {};
      const updatedProfile = {
        ...currentProfile,
        phoneNumber: form.phoneNumber,
        address: form.address,
        emergencyContactName: form.emergencyContactName,
        emergencyContactPhone: form.emergencyContactPhone,
        emergencyContactRelation: form.emergencyContactRelation,
      };

      await updateUserProfile(auth.userId, {
        name: form.name,
        profile: JSON.stringify(updatedProfile),
      });

      updateLocalSession({ name: form.name });
      await refreshSession();
      addToast('Profile updated successfully!', 'success');
      setEditing(false);
      loadProfile();
    } catch (e) {
      addToast('Failed to save: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="loading-overlay">
        <div className="spinner spinner-lg" />
        <span>Loading profile...</span>
      </div>
    );
  }

  const profile = parseJsonSafe(userData?.profile) || {};
  const workStats = parseJsonSafe(userData?.workStats || auth?.workStats) || {};
  const issues = parseJsonSafe(userData?.issues || auth?.issues) || {};
  let permissions = [];
  try { permissions = JSON.parse(userData?.permissions || '[]'); } catch {}
  if (permissions.length === 0) permissions = auth?.permissions || [];

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>My Profile</h1>
          <p>View and manage your personal information</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-outline" onClick={() => { loadProfile(); refreshSession(); }}>
            <RefreshCw size={16} /> Refresh
          </button>
          {!auth?.isSuperuser && (
            <button
              className={`btn ${editing ? 'btn-danger' : 'btn-primary'}`}
              onClick={() => setEditing(e => !e)}
            >
              <Edit3 size={16} /> {editing ? 'Cancel Edit' : 'Edit Profile'}
            </button>
          )}
        </div>
      </div>

      {/* Profile Header Card */}
      <div className="profile-header-card">
        <div className="profile-avatar-large">
          {(auth?.name || 'U').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div className="profile-header-info">
          <h2>{auth?.name || 'User'}</h2>
          <p className="profile-email">{auth?.email}</p>
          <div className="profile-tags">
            <span className={`badge badge-${getRoleBadgeColor(auth?.role)}`}>
              {auth?.role?.replace(/_/g, ' ')}
            </span>
            {auth?.designation && (
              <span className="badge badge-blue">{auth?.designation}</span>
            )}
            {auth?.isSuperuser && (
              <span className="badge badge-rose">Superuser</span>
            )}
          </div>
        </div>
        <div className="profile-header-meta">
          {auth?.companyName && (
            <div className="profile-meta-item">
              <Building2 size={14} /> {auth.companyName}
            </div>
          )}
          {auth?.department && (
            <div className="profile-meta-item">
              <FolderOpen size={14} /> {auth.department}
            </div>
          )}
          {userData?.created && (
            <div className="profile-meta-item">
              <Clock size={14} /> Joined {formatDate(userData.created)}
            </div>
          )}
        </div>
      </div>

      <div className="profile-grid">
        {/* Personal Information */}
        <div className="card profile-section">
          <h3><User size={18} /> Personal Information</h3>
          <div className="profile-fields">
            <div className="profile-field">
              <label>Full Name</label>
              {editing ? (
                <input className="input" value={form.name} onChange={e => update('name', e.target.value)} />
              ) : (
                <span>{auth?.name || '—'}</span>
              )}
            </div>
            <div className="profile-field">
              <label><Mail size={13} /> Email</label>
              <span>{auth?.email || '—'}</span>
            </div>
            <div className="profile-field">
              <label><Phone size={13} /> Phone</label>
              {editing ? (
                <input className="input" value={form.phoneNumber} onChange={e => update('phoneNumber', e.target.value)} placeholder="+91 9876543210" />
              ) : (
                <span>{profile.phoneNumber || form.phoneNumber || '—'}</span>
              )}
            </div>
            <div className="profile-field">
              <label><MapPin size={13} /> Address</label>
              {editing ? (
                <input className="input" value={form.address} onChange={e => update('address', e.target.value)} placeholder="Your address" />
              ) : (
                <span>{profile.address || form.address || '—'}</span>
              )}
            </div>
            <div className="profile-field">
              <label><Briefcase size={13} /> Employee ID</label>
              <span>{profile.employeeId || '—'}</span>
            </div>
            <div className="profile-field">
              <label><Users size={13} /> Reporting To</label>
              <span>{profile.reportingTo || '—'}</span>
            </div>
          </div>

          {editing && (
            <>
              <h4 style={{ marginTop: 20, fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                <AlertCircle size={14} /> Emergency Contact
              </h4>
              <div className="profile-fields" style={{ marginTop: 8 }}>
                <div className="profile-field">
                  <label>Contact Name</label>
                  <input className="input" value={form.emergencyContactName} onChange={e => update('emergencyContactName', e.target.value)} placeholder="Emergency contact name" />
                </div>
                <div className="profile-field">
                  <label>Contact Phone</label>
                  <input className="input" value={form.emergencyContactPhone} onChange={e => update('emergencyContactPhone', e.target.value)} placeholder="Phone number" />
                </div>
                <div className="profile-field">
                  <label>Relation</label>
                  <input className="input" value={form.emergencyContactRelation} onChange={e => update('emergencyContactRelation', e.target.value)} placeholder="Spouse, parent, etc." />
                </div>
              </div>
              <div className="profile-save-bar">
                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                  {saving ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Saving...</> : <><Save size={16} /> Save Changes</>}
                </button>
                <button className="btn btn-outline" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </>
          )}
        </div>

        {/* Organization Info */}
        <div className="card profile-section">
          <h3><Building2 size={18} /> Organization</h3>
          <div className="profile-fields">
            <div className="profile-field">
              <label>Role</label>
              <span className={`badge badge-${getRoleBadgeColor(auth?.role)}`}>{auth?.role?.replace(/_/g, ' ')}</span>
            </div>
            <div className="profile-field">
              <label>Company</label>
              <span>{auth?.companyName || '—'}</span>
            </div>
            <div className="profile-field">
              <label>Department</label>
              <span>{auth?.department || '—'}</span>
            </div>
            <div className="profile-field">
              <label>Designation</label>
              <span>{auth?.designation || '—'}</span>
            </div>
            <div className="profile-field">
              <label>Status</label>
              <span className="status-active">
                <span className={`status-dot ${userData?.isActive !== false ? 'online' : 'offline'}`} />
                {userData?.isActive !== false ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        {/* Work Stats */}
        <div className="card profile-section">
          <h3><Activity size={18} /> Work Stats</h3>
          <div className="profile-stats-grid">
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
              <div className="profile-stat-label">Pending Tasks</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value">{workStats.totalWorkingHours || 0}h</div>
              <div className="profile-stat-label">Working Hours</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value">
                <Star size={14} style={{ color: 'var(--accent-amber)', marginRight: 4 }} />
                {workStats.avgPerformanceRating?.toFixed(1) || '0.0'}
              </div>
              <div className="profile-stat-label">Avg Rating</div>
            </div>
          </div>
        </div>

        {/* Issues / Complaints */}
        <div className="card profile-section">
          <h3><AlertCircle size={18} /> Issues</h3>
          <div className="profile-stats-grid">
            <div className="profile-stat">
              <div className="profile-stat-value" style={{ color: 'var(--accent-blue)' }}>{issues.totalComplaints || 0}</div>
              <div className="profile-stat-label">Total Complaints</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value" style={{ color: 'var(--accent-emerald)' }}>
                <CheckCircle size={14} style={{ marginRight: 4 }} />
                {issues.resolvedComplaints || 0}
              </div>
              <div className="profile-stat-label">Resolved</div>
            </div>
            <div className="profile-stat">
              <div className="profile-stat-value" style={{ color: 'var(--accent-amber)' }}>
                <XCircle size={14} style={{ marginRight: 4 }} />
                {issues.pendingComplaints || 0}
              </div>
              <div className="profile-stat-label">Pending</div>
            </div>
          </div>
        </div>
      </div>

      {/* Permissions */}
      {permissions.length > 0 && (
        <div className="card profile-section" style={{ marginTop: 20 }}>
          <h3><ShieldCheck size={18} /> My Permissions ({permissions.length})</h3>
          <div className="permission-groups">
            {Object.entries(PERMISSION_GROUPS).map(([groupName, groupPerms]) => {
              const activePerms = groupPerms.filter(p => permissions.includes(p));
              if (activePerms.length === 0) return null;
              return (
                <div key={groupName} className="perm-group">
                  <div className="perm-group-title">{groupName}</div>
                  <div className="perm-group-items">
                    {activePerms.map(p => (
                      <span key={p} className="badge badge-blue">{formatPermission(p)}</span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
