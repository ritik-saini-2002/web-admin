// ═══════════════════════════════════════════════════════════════════════════
// Permissions utility — mirrors Permissions.kt (Database-driven RBAC)
// ═══════════════════════════════════════════════════════════════════════════

export const ROLES = {
  SYSTEM_ADMIN: 'System_Administrator',
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  HR: 'HR',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
  INTERN: 'Intern',
};

export const ALL_ROLES = [
  ROLES.SYSTEM_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.HR,
  ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN,
];

export const ADMIN_ASSIGNABLE_ROLES = [
  ROLES.ADMIN, ROLES.MANAGER, ROLES.HR,
  ROLES.TEAM_LEAD, ROLES.EMPLOYEE, ROLES.INTERN,
];

// ── Permission Groups (organized for the permission-toggle UI) ───────────

export const PERMISSION_GROUPS = {
  'User Management': [
    'create_user', 'delete_user', 'modify_user', 'view_all_users',
  ],
  'Role & Permission Management': [
    'manage_roles', 'manage_permissions', 'grant_revoke_any_permission',
    'edit_system_administrator',
  ],
  'Company & Department': [
    'manage_companies', 'view_all_companies', 'manage_all_companies',
  ],
  'Analytics & Reports': [
    'view_analytics', 'export_data', 'view_reports', 'generate_reports',
    'view_audit_logs',
  ],
  'System Administration': [
    'system_settings', 'manage_system_settings', 'access_all_data',
    'access_admin_panel', 'database_manager',
  ],
  'Remote PC Access': [
    'remote_access',
  ],
  'Team Management': [
    'view_team_users', 'modify_team_user', 'view_team_analytics',
    'assign_projects', 'approve_requests', 'assign_tasks',
    'view_team_performance', 'approve_leave',
  ],
  'HR Operations': [
    'view_hr_analytics', 'manage_employees', 'access_personal_data',
  ],
  'Complaints': [
    'submit_complaints', 'view_all_complaints', 'resolve_complaints',
    'view_department_complaints', 'view_team_complaints', 'view_own_complaints',
  ],
  'Personal': [
    'view_profile', 'edit_profile', 'edit_basic_profile',
    'view_assigned_projects', 'view_assigned_tasks', 'submit_reports',
  ],
};

// Flat list of all known permissions
export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

export function getRoleBadgeColor(role) {
  switch (role) {
    case ROLES.SYSTEM_ADMIN: return 'rose';
    case ROLES.ADMIN: return 'purple';
    case ROLES.MANAGER: return 'blue';
    case ROLES.HR: return 'amber';
    case ROLES.TEAM_LEAD: return 'cyan';
    case ROLES.EMPLOYEE: return 'emerald';
    case ROLES.INTERN: return 'blue';
    default: return 'blue';
  }
}

/** Check if a role is an admin-level role */
export function isAdminRole(role) {
  return role === ROLES.SYSTEM_ADMIN || role === ROLES.ADMIN;
}

/** Check if a role is a management-level role (can see team/dept data) */
export function isManagementRole(role) {
  return [ROLES.SYSTEM_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.HR, ROLES.TEAM_LEAD].includes(role);
}

/** Get human-readable permission name */
export function formatPermission(perm) {
  return perm.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
