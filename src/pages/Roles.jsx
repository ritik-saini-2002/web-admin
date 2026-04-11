import { useState } from 'react';
import { ShieldCheck, Users, ChevronRight, Check } from 'lucide-react';
import { ALL_ROLES, getRoleBadgeColor } from '../utils/permissions';
import { getPermissionsForRole } from '../api/pocketbase';

export default function RolesPage() {
  const [selectedRole, setSelectedRole] = useState('System_Administrator');
  const permissions = getPermissionsForRole(selectedRole);

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Role Management</h1>
          <p>View roles and their assigned permissions</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20 }}>
        {/* Role List */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.88rem', fontWeight: 700 }}>Roles ({ALL_ROLES.length})</h3>
          </div>
          <div style={{ padding: 8 }}>
            {ALL_ROLES.map(role => (
              <div
                key={role}
                className={`nav-item ${selectedRole === role ? 'active' : ''}`}
                onClick={() => setSelectedRole(role)}
                style={{ marginBottom: 2 }}
              >
                <span className="nav-item-icon">
                  <ShieldCheck size={18} />
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{role.replace(/_/g, ' ')}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                    {getPermissionsForRole(role).length} permissions
                  </div>
                </div>
                <ChevronRight size={14} style={{ opacity: 0.3 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Permission Detail */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div className={`stat-icon ${getRoleBadgeColor(selectedRole)}`} style={{ width: 42, height: 42 }}>
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 700 }}>{selectedRole.replace(/_/g, ' ')}</h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>{permissions.length} permissions assigned</p>
            </div>
            <span className={`badge badge-${getRoleBadgeColor(selectedRole)}`} style={{ marginLeft: 'auto' }}>
              {selectedRole === 'System_Administrator' ? 'Super Admin' : selectedRole === 'Administrator' ? 'Company Admin' : 'Standard'}
            </span>
          </div>

          <h3 style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>
            Assigned Permissions
          </h3>

          <div className="perm-grid">
            {permissions.map(p => (
              <div key={p} className="perm-item active">
                <div className="perm-checkbox"><Check size={10} strokeWidth={3} /></div>
                <span>{p.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>

          {selectedRole === 'System_Administrator' && (
            <div style={{ marginTop: 20, padding: '14px 16px', background: 'var(--accent-rose-soft)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--accent-rose)' }}>
              ⚠️ System Administrator has full access across all companies and database management. This role is auto-assigned to PocketBase superusers.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
