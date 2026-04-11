// Permissions utility — mirrors Permissions.kt
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

export const ALL_PERMISSIONS = [
  'create_user', 'delete_user', 'modify_user', 'view_all_users',
  'manage_roles', 'view_analytics', 'system_settings', 'manage_companies',
  'access_all_data', 'export_data', 'manage_permissions', 'access_admin_panel',
  'submit_complaints', 'view_all_complaints', 'resolve_complaints',
  'database_manager', 'view_all_companies', 'manage_all_companies',
  'edit_system_administrator', 'grant_revoke_any_permission',
  'manage_system_settings', 'view_audit_logs',
  'view_team_users', 'modify_team_user', 'view_team_analytics',
  'assign_projects', 'approve_requests', 'view_reports',
  'view_department_complaints',
  'view_hr_analytics', 'manage_employees', 'access_personal_data', 'generate_reports',
  'assign_tasks', 'view_team_performance', 'approve_leave', 'view_team_complaints',
  'view_profile', 'edit_profile', 'view_assigned_projects', 'submit_reports', 'view_own_complaints',
  'edit_basic_profile', 'view_assigned_tasks',
];

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
