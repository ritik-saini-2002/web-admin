// ═══════════════════════════════════════════════════════════════════════════
// PocketBase API Client — mirrors PocketBaseDataSource.kt
// ═══════════════════════════════════════════════════════════════════════════

const PB_HOST  = import.meta.env.VITE_PB_HOST  || '192.168.7.28';
const PB_PORT  = import.meta.env.VITE_PB_PORT  || '5005';
const BASE_URL = `http://${PB_HOST}:${PB_PORT}`;

const ADMIN_EMAIL    = import.meta.env.VITE_PB_ADMIN_EMAIL    || '';
const ADMIN_PASSWORD = import.meta.env.VITE_PB_ADMIN_PASSWORD || '';

// Collection names — match PocketBaseDataSource.kt
export const COL_USERS          = 'users';
export const COL_COMPANIES      = 'companies_metadata';
export const COL_ACCESS_CONTROL = 'user_access_control';
export const COL_SEARCH_INDEX   = 'user_search_index';

let adminToken = '';
let adminTokenFetchedAt = 0;
const ADMIN_TOKEN_TTL = 10 * 60 * 1000; // 10 min

// ── Helpers ──────────────────────────────────────────────────────────────

async function request(method, url, token = '', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { ok: res.ok, status: res.status, data: json };
}

// ── Admin Auth ──────────────────────────────────────────────────────────

/**
 * Authenticate with user-provided credentials (used by the login form).
 * Tries superuser endpoints first, then falls back to regular user auth.
 */
export async function authenticateAdmin(email, password) {
  // 1) Try superuser auth
  const superuserEndpoints = [
    `${BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${BASE_URL}/api/admins/auth-with-password`,
  ];

  for (const url of superuserEndpoints) {
    try {
      const res = await request('POST', url, '', {
        identity: email,
        password,
      });
      if (res.ok && res.data?.token) {
        adminToken = res.data.token;
        adminTokenFetchedAt = Date.now();
        return {
          token: res.data.token,
          isSuperuser: true,
          name: res.data.record?.name || res.data.admin?.name || 'Admin',
          email,
          role: 'System_Administrator',
          permissions: getPermissionsForRole('System_Administrator'),
          companyName: '',
          department: '',
          designation: 'Superuser',
        };
      }
    } catch (e) {
      // try next endpoint
    }
  }

  // 2) Try regular user auth from users collection
  try {
    const res = await request('POST', `${BASE_URL}/api/collections/${COL_USERS}/auth-with-password`, '', {
      identity: email,
      password,
    });
    if (res.ok && res.data?.token) {
      const user = res.data.record || {};
      let perms = [];
      try { perms = JSON.parse(user.permissions || '[]'); } catch { perms = []; }
      return {
        token: res.data.token,
        isSuperuser: false,
        userId: user.id,
        name: user.name || email.split('@')[0],
        email: user.email || email,
        role: user.role || 'Employee',
        permissions: perms.length > 0 ? perms : getPermissionsForRole(user.role || 'Employee'),
        companyName: user.companyName || '',
        department: user.department || '',
        designation: user.designation || '',
        isActive: user.isActive !== false,
      };
    }
  } catch (e) {
    // fall through
  }

  throw new Error('Invalid credentials or PocketBase is unreachable.');
}

/**
 * Get a cached admin token for background API calls.
 * Uses .env credentials only as a fallback if no user has logged in yet.
 */
export async function getAdminToken() {
  const now = Date.now();
  if (adminToken && (now - adminTokenFetchedAt) < ADMIN_TOKEN_TTL) return adminToken;

  const endpoints = [
    `${BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${BASE_URL}/api/admins/auth-with-password`,
  ];

  for (const url of endpoints) {
    try {
      const res = await request('POST', url, '', {
        identity: ADMIN_EMAIL,
        password: ADMIN_PASSWORD,
      });
      if (res.ok && res.data?.token) {
        adminToken = res.data.token;
        adminTokenFetchedAt = now;
        return adminToken;
      }
    } catch (e) {
      console.warn('Admin auth failed:', url, e);
    }
  }
  throw new Error('Failed to obtain admin token');
}

// ── User Auth ──────────────────────────────────────────────────────────

export async function loginUser(email, password) {
  const res = await request('POST', `${BASE_URL}/api/collections/${COL_USERS}/auth-with-password`, '', {
    identity: email,
    password,
  });
  if (!res.ok) throw new Error(res.data?.message || `Login failed: HTTP ${res.status}`);
  return res.data;
}

// ── Health ──────────────────────────────────────────────────────────────

export async function checkHealth() {
  try {
    const res = await request('GET', `${BASE_URL}/api/health`);
    return res.ok;
  } catch { return false; }
}

// ── Generic CRUD ────────────────────────────────────────────────────────

export async function listRecords(collection, params = {}) {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params.page) query.set('page', params.page);
  if (params.perPage) query.set('perPage', params.perPage);
  if (params.filter) query.set('filter', params.filter);
  if (params.sort) query.set('sort', params.sort);
  if (params.expand) query.set('expand', params.expand);
  const qs = query.toString();
  const url = `${BASE_URL}/api/collections/${collection}/records${qs ? '?' + qs : ''}`;
  const res = await request('GET', url, token);
  if (!res.ok) throw new Error(`listRecords(${collection}) HTTP ${res.status}`);
  return res.data;
}

export async function getRecord(collection, id) {
  const token = await getAdminToken();
  const res = await request('GET', `${BASE_URL}/api/collections/${collection}/records/${id}`, token);
  if (!res.ok) throw new Error(`getRecord(${collection}, ${id}) HTTP ${res.status}`);
  return res.data;
}

export async function createRecord(collection, data) {
  const token = await getAdminToken();
  const res = await request('POST', `${BASE_URL}/api/collections/${collection}/records`, token, data);
  if (!res.ok) {
    const msg = parseErrors(res.data);
    throw new Error(msg || `createRecord failed: HTTP ${res.status}`);
  }
  return res.data;
}

export async function updateRecord(collection, id, data) {
  const token = await getAdminToken();
  const res = await request('PATCH', `${BASE_URL}/api/collections/${collection}/records/${id}`, token, data);
  if (!res.ok) {
    const msg = parseErrors(res.data);
    throw new Error(msg || `updateRecord failed: HTTP ${res.status}`);
  }
  return res.data;
}

export async function deleteRecord(collection, id) {
  const token = await getAdminToken();
  const res = await request('DELETE', `${BASE_URL}/api/collections/${collection}/records/${id}`, token);
  if (!res.ok) throw new Error(`deleteRecord failed: HTTP ${res.status}`);
  return true;
}

// ── Collections (schemas) ───────────────────────────────────────────────

export async function listCollections() {
  const token = await getAdminToken();
  const res = await request('GET', `${BASE_URL}/api/collections?perPage=200`, token);
  if (!res.ok) throw new Error(`listCollections HTTP ${res.status}`);
  return res.data;
}

export async function getCollection(nameOrId) {
  const token = await getAdminToken();
  const res = await request('GET', `${BASE_URL}/api/collections/${nameOrId}`, token);
  if (!res.ok) throw new Error(`getCollection HTTP ${res.status}`);
  return res.data;
}

// ── User-specific operations ────────────────────────────────────────────

export async function createUserFull({
  email, password, name, role, companyName, department, designation, phoneNumber = '',
}) {
  const token = await getAdminToken();

  // 1. Create auth user
  const userRes = await request('POST', `${BASE_URL}/api/collections/${COL_USERS}/records`, token, {
    email, password, passwordConfirm: password, name, emailVisibility: true,
  });
  if (!userRes.ok) {
    const msg = parseErrors(userRes.data);
    throw new Error(msg || `Create user failed: HTTP ${userRes.status}`);
  }
  const userId = userRes.data.id;
  const sc = sanitize(companyName);
  const sd = sanitize(department);
  const documentPath = `users/${sc}/${sd}/${role}/${userId}`;
  const permissions = JSON.stringify(getPermissionsForRole(role));

  // 2. Patch user record with profile data
  await request('PATCH', `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`, token, {
    userId, role, companyName, sanitizedCompanyName: sc,
    department, sanitizedDepartment: sd, designation, isActive: true,
    documentPath, permissions, needsProfileCompletion: true,
    profile: JSON.stringify({ imageUrl: '', phoneNumber, address: '', employeeId: '', reportingTo: '', salary: 0, emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '' }),
    workStats: JSON.stringify({ experience: 0, completedProjects: 0, activeProjects: 0, pendingTasks: 0, completedTasks: 0, totalWorkingHours: 0, avgPerformanceRating: 0.0 }),
    issues: JSON.stringify({ totalComplaints: 0, resolvedComplaints: 0, pendingComplaints: 0 }),
  });

  // 3. Create access control record
  await request('POST', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records`, token, {
    userId, name, email, companyName, sanitizedCompanyName: sc,
    department, sanitizedDepartment: sd, role, designation,
    permissions, isActive: true, documentPath, needsProfileCompletion: true,
  });

  // 4. Create search index
  const searchTerms = JSON.stringify(
    [name, email, companyName, department, role, designation].map(s => s.toLowerCase()).filter(Boolean)
  );
  await request('POST', `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records`, token, {
    userId, name: name.toLowerCase(), email: email.toLowerCase(),
    companyName, sanitizedCompanyName: sc, department, sanitizedDepartment: sd,
    role, designation, isActive: true, searchTerms, documentPath,
  });

  return userId;
}

export async function toggleUserActive(userId, isActive) {
  const token = await getAdminToken();
  await request('PATCH', `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`, token, { isActive });

  // Also update access control
  const acRes = await request('GET', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`, token);
  if (acRes.ok && acRes.data?.items?.length > 0) {
    const acId = acRes.data.items[0].id;
    await request('PATCH', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`, token, { isActive });
  }
}

export async function changeUserRole(userId, newRole) {
  const token = await getAdminToken();
  const permissions = JSON.stringify(getPermissionsForRole(newRole));
  await request('PATCH', `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`, token, { role: newRole, permissions });

  const acRes = await request('GET', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`, token);
  if (acRes.ok && acRes.data?.items?.length > 0) {
    const acId = acRes.data.items[0].id;
    await request('PATCH', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`, token, { role: newRole, permissions });
  }
}

export async function deleteUserFull(userId) {
  const token = await getAdminToken();

  // Delete access control
  const acRes = await request('GET', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`, token);
  if (acRes.ok && acRes.data?.items?.length > 0) {
    await request('DELETE', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acRes.data.items[0].id}`, token);
  }

  // Delete search index
  const siRes = await request('GET', `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records?filter=(userId='${userId}')&perPage=1`, token);
  if (siRes.ok && siRes.data?.items?.length > 0) {
    await request('DELETE', `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records/${siRes.data.items[0].id}`, token);
  }

  // Delete user
  await request('DELETE', `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`, token);
}

// ── Helpers ─────────────────────────────────────────────────────────────

function parseErrors(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  if (data.data && typeof data.data === 'object') {
    return Object.entries(data.data)
      .map(([k, v]) => `${k}: ${v?.message || 'invalid'}`)
      .join(', ');
  }
  return data.message || '';
}

function sanitize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// Permission mapping — mirrors Permissions.kt
function getPermissionsForRole(role) {
  const perms = {
    System_Administrator: [
      'create_user','delete_user','modify_user','view_all_users','manage_roles','view_analytics',
      'system_settings','manage_companies','access_all_data','export_data','manage_permissions',
      'access_admin_panel','submit_complaints','view_all_complaints','resolve_complaints',
      'database_manager','view_all_companies','manage_all_companies','edit_system_administrator',
      'grant_revoke_any_permission','manage_system_settings','view_audit_logs',
    ],
    Administrator: [
      'create_user','delete_user','modify_user','view_all_users','manage_roles','view_analytics',
      'system_settings','manage_companies','access_all_data','export_data','manage_permissions',
      'access_admin_panel','submit_complaints','view_all_complaints','resolve_complaints',
    ],
    Manager: [
      'view_team_users','modify_team_user','view_team_analytics','assign_projects','approve_requests',
      'view_reports','submit_complaints','view_department_complaints','resolve_complaints','access_admin_panel',
    ],
    HR: [
      'view_all_users','modify_user','view_hr_analytics','manage_employees','access_personal_data',
      'generate_reports','submit_complaints','view_all_complaints','resolve_complaints','access_admin_panel',
    ],
    'Team Lead': ['view_team_users','assign_tasks','view_team_performance','approve_leave','submit_complaints','view_team_complaints'],
    Employee: ['view_profile','edit_profile','view_assigned_projects','submit_reports','submit_complaints','view_own_complaints'],
    Intern: ['view_profile','edit_basic_profile','view_assigned_tasks','submit_complaints'],
  };
  return perms[role] || ['view_profile'];
}

export { BASE_URL, sanitize, getPermissionsForRole };
