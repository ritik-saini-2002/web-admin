// ═══════════════════════════════════════════════════════════════════════════
// PocketBase API Client — mirrors PocketBaseDataSource.kt
// Heavy-duty: request caching, dedup, profile & permission management
// ═══════════════════════════════════════════════════════════════════════════

import { cachedFetch, invalidateCache, invalidateCollection, makeCacheKey } from '../utils/apiCache';

const PB_URL  = import.meta.env.VITE_PB_URL;
const PB_HOST = import.meta.env.VITE_PB_HOST || '192.168.5.32';
const PB_PORT = import.meta.env.VITE_PB_PORT || '';
const PB_PATH = import.meta.env.VITE_PB_PATH || '/pocketbase';
const BASE_URL = (PB_URL || `http://${PB_HOST}${PB_PORT ? `:${PB_PORT}` : ''}${PB_PATH}`).replace(/\/+$/, '');

const ADMIN_EMAIL    = import.meta.env.VITE_PB_ADMIN_EMAIL    || '';
const ADMIN_PASSWORD = import.meta.env.VITE_PB_ADMIN_PASSWORD || '';
const AUTH_REQUEST_TIMEOUT = 60_000;

// ── Service account used exclusively by the PC Agent to write heartbeats ──
const AGENT_SERVICE_EMAIL    = 'service@itconnect.internal';
const AGENT_SERVICE_PASSWORD = 'Ritik@2002';

// Collection names — match PocketBaseDataSource.kt
export const COL_USERS          = 'users';
export const COL_COMPANIES      = 'companies_metadata';
export const COL_ACCESS_CONTROL = 'user_access_control';
export const COL_SEARCH_INDEX   = 'user_search_index';
export const COL_PC_AGENTS      = 'pc_agents';
export const COL_COMPUTER_INVENTORY = 'computer_inventory'; // written by CollectComputerData.ps1

// ── Token cache ────────────────────────────────────────────────────────────
let adminToken            = '';
let adminTokenFetchedAt   = 0;
let serviceToken          = '';
let serviceTokenFetchedAt = 0;
const ADMIN_TOKEN_TTL   = 600 * 60 * 1000; // 10 min
const SERVICE_TOKEN_TTL = 600 * 60 * 1000; // 10 min

// ── Auth expiry event ──────────────────────────────────────────────────────
// Fired ONLY when a request comes back 401 (the token itself is invalid or
// expired). A 403 means the token is still valid but the account isn't
// allowed to do that specific thing (e.g. a non-superuser hitting a
// superuser-only PocketBase endpoint like /api/collections) — that is a
// per-request permission problem, not a broken session, so it must NOT land
// here or it will wipe the shared token for the whole app.
// Debounced so rapid parallel failures don't fire it dozens of times.
let _authExpiredDebounce = null;
export function fireAuthExpired(reason = 'token_expired') {
  if (_authExpiredDebounce) return;
  _authExpiredDebounce = setTimeout(() => {
    _authExpiredDebounce = null;
  }, 3000);
  // Clear our cached tokens immediately
  adminToken          = '';
  adminTokenFetchedAt = 0;
  window.dispatchEvent(new CustomEvent('pb:auth-expired', { detail: { reason } }));
}

// ── Core HTTP helper ───────────────────────────────────────────────────────

async function request(method, url, token = '', body = null, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers, signal: controller.signal };
  if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }

    // ── Auto-logout on 401 ONLY (expired/invalid token) ──────────────────
    // Skip auth endpoints themselves — a wrong password on login should NOT
    // trigger a logout event (that would be confusing UX).
    //
    // 403 is deliberately excluded: it means "valid token, insufficient
    // privileges for this one call" (e.g. a non-superuser calling the
    // superuser-only /api/collections route). Treating that as a global
    // session expiry used to wipe the shared adminToken cache and break
    // every other page's data loading until a full logout/login — that was
    // the cause of the "disconnects when I open Database Manager" bug.
    // Callers that care about 403 specifically can check res.status themselves.
    const isAuthEndpoint =
        url.includes('/auth-with-password') ||
        url.includes('/api/admins/auth');

    if (!isAuthEndpoint && res.status === 401) {
      fireAuthExpired('token_expired');
    }

    return { ok: res.ok, status: res.status, data: json };
  } finally {
    clearTimeout(timer);
  }
}

// ── Admin Auth ─────────────────────────────────────────────────────────────

/**
 * Authenticate with user-provided credentials (used by the login form).
 * Tries regular user auth first, then superuser endpoints.
 */
export async function authenticateAdmin(email, password) {
  // 1) Try regular user auth
  try {
    const res = await request(
        'POST',
        `${BASE_URL}/api/collections/${COL_USERS}/auth-with-password`,
        '',
        { identity: email, password },
        AUTH_REQUEST_TIMEOUT,
    );
    if (res.ok && res.data?.token) {
      adminToken = res.data.token;
      adminTokenFetchedAt = Date.now();
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
        profile: user.profile || '{}',
        workStats: user.workStats || '{}',
        issues: user.issues || '{}',
        phoneNumber: user.phoneNumber || '',
      };
    }
  } catch {
    // fall through to superuser endpoints
  }

  // 2) Try superuser endpoints
  const superuserEndpoints = [
    `${BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${BASE_URL}/api/admins/auth-with-password`,
  ];

  for (const url of superuserEndpoints) {
    try {
      const res = await request(
          'POST', url, '',
          { identity: email, password },
          AUTH_REQUEST_TIMEOUT,
      );
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
    } catch {
      // try next
    }
  }

  throw new Error('Invalid credentials or PocketBase is unreachable.');
}

/**
 * Read the token AuthContext already persisted to localStorage on login.
 * Used as a fallback so a page refresh — which wipes the in-memory
 * adminToken cache below, since it's just a JS module variable — doesn't
 * force every page's data calls to fail. The person's session is still
 * perfectly valid; we just lost the in-memory copy of it.
 */
function getStoredSessionToken() {
  try {
    const raw = localStorage.getItem('itc_auth');
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    return parsed?.token || '';
  } catch {
    return '';
  }
}

/**
 * Get a cached admin token for background API calls.
 * Falls back to the persisted session token (survives page refresh), then
 * to .env credentials, if no valid token is cached in memory.
 */
export async function getAdminToken() {
  const now = Date.now();
  if (adminToken && (now - adminTokenFetchedAt) < ADMIN_TOKEN_TTL) return adminToken;

  // Reuse the token from localStorage before giving up — this is what makes
  // a page refresh not behave like a logout.
  const stored = getStoredSessionToken();
  if (stored) {
    adminToken = stored;
    adminTokenFetchedAt = now;
    return adminToken;
  }

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    // No stored session and no .env fallback — there's genuinely no valid
    // token available. This does NOT log the user out by itself; it just
    // surfaces an error on this one request. See fireAuthExpired() above —
    // nothing auto-triggers logout() from it.
    fireAuthExpired('token_expired');
    throw new Error('Session expired. Please log in again.');
  }

  const endpoints = [
    `${BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${BASE_URL}/api/admins/auth-with-password`,
  ];

  for (const url of endpoints) {
    try {
      const res = await request(
          'POST', url, '',
          { identity: ADMIN_EMAIL, password: ADMIN_PASSWORD },
          AUTH_REQUEST_TIMEOUT,
      );
      if (res.ok && res.data?.token) {
        adminToken = res.data.token;
        adminTokenFetchedAt = now;
        return adminToken;
      }
    } catch (e) {
      console.warn('Admin auth failed:', url, e);
    }
  }
  throw new Error('Failed to obtain admin token. Check VITE_PB_ADMIN_EMAIL and VITE_PB_ADMIN_PASSWORD in .env');
}

// ── Service Account Token ─────────────────────────────────────────────────

/**
 * Some PocketBase endpoints (schema listing at /api/collections, etc.) are
 * hard-coded to superuser-only at the PocketBase engine level — this is NOT
 * governed by your app's own roles/permissions. A "users" collection account
 * with role = 'System_Administrator' set via the Roles page is a perfectly
 * valid app-level admin, but it is not a PocketBase superuser, and never
 * will be no matter what permissions you grant it.
 *
 * This token is always fetched with dedicated superuser credentials from
 * .env, completely independent of whichever human is currently logged into
 * the app — same pattern as getServiceToken() below, just for a different
 * purpose. Pages should gate visibility on the app's own permission (e.g.
 * 'database_manager'), and use THIS token (not getAdminToken()) for the
 * specific calls that require genuine superuser rights.
 */
let superuserToken          = '';
let superuserTokenFetchedAt = 0;
const SUPERUSER_TOKEN_TTL = 600 * 60 * 1000; // 10 min

export async function getSuperuserToken() {
  const now = Date.now();
  if (superuserToken && (now - superuserTokenFetchedAt) < SUPERUSER_TOKEN_TTL) return superuserToken;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error(
        'This feature requires PocketBase superuser access. Set VITE_PB_ADMIN_EMAIL ' +
        'and VITE_PB_ADMIN_PASSWORD in .env to a real PocketBase superuser account ' +
        '(one that exists in the built-in "_superusers" collection, not the "users" ' +
        'collection) and rebuild — app roles/permissions can\'t substitute for this.',
    );
  }

  const endpoints = [
    `${BASE_URL}/api/collections/_superusers/auth-with-password`,
    `${BASE_URL}/api/admins/auth-with-password`,
  ];

  for (const url of endpoints) {
    try {
      const res = await request(
          'POST', url, '',
          { identity: ADMIN_EMAIL, password: ADMIN_PASSWORD },
          AUTH_REQUEST_TIMEOUT,
      );
      if (res.ok && res.data?.token) {
        superuserToken = res.data.token;
        superuserTokenFetchedAt = now;
        return superuserToken;
      }
    } catch (e) {
      console.warn('Superuser auth failed:', url, e);
    }
  }
  throw new Error('Failed to obtain superuser token. Check VITE_PB_ADMIN_EMAIL and VITE_PB_ADMIN_PASSWORD in .env are a valid superuser account.');
}

export async function getServiceToken() {
  const now = Date.now();
  if (serviceToken && (now - serviceTokenFetchedAt) < SERVICE_TOKEN_TTL) return serviceToken;

  const res = await request(
      'POST',
      `${BASE_URL}/api/collections/${COL_USERS}/auth-with-password`,
      '',
      { identity: AGENT_SERVICE_EMAIL, password: AGENT_SERVICE_PASSWORD },
      AUTH_REQUEST_TIMEOUT,
  );

  if (!res.ok || !res.data?.token) {
    throw new Error(
        `Service account auth failed (${res.status}). ` +
        `Make sure "${AGENT_SERVICE_EMAIL}" exists in the "users" collection ` +
        `and has write access to "pc_agents".`,
    );
  }

  serviceToken = res.data.token;
  serviceTokenFetchedAt = now;
  return serviceToken;
}

// ── User Auth ──────────────────────────────────────────────────────────────

export async function loginUser(email, password) {
  const res = await request(
      'POST',
      `${BASE_URL}/api/collections/${COL_USERS}/auth-with-password`,
      '',
      { identity: email, password },
  );
  if (!res.ok) throw new Error(res.data?.message || `Login failed: HTTP ${res.status}`);
  return res.data;
}

// ── Health ─────────────────────────────────────────────────────────────────

export async function checkHealth() {
  try {
    const res = await request('GET', `${BASE_URL}/api/health`);
    return res.ok;
  } catch { return false; }
}

// ── Generic CRUD (with caching) ────────────────────────────────────────────

export async function listRecords(collection, params = {}) {
  const token = await getAdminToken();
  const query = new URLSearchParams();
  if (params.page)    query.set('page',    params.page);
  if (params.perPage) query.set('perPage', params.perPage);
  if (params.filter)  query.set('filter',  params.filter);
  if (params.sort)    query.set('sort',    params.sort);
  if (params.expand)  query.set('expand',  params.expand);
  const qs  = query.toString();
  const url = `${BASE_URL}/api/collections/${collection}/records${qs ? '?' + qs : ''}`;

  const cacheKey = makeCacheKey('GET', url, null);
  if (params.noCache) invalidateCache(cacheKey);

  return cachedFetch(
      () => request('GET', url, token).then(res => {
        if (!res.ok) {
          // Surface PocketBase's own error text (e.g. "Invalid sort parameter
          // format" or a specific unknown-field message) instead of a bare
          // status code — callers and the person reading the toast both need
          // this to actually diagnose a 400.
          const serverMsg = res.data?.message || parseErrors(res.data);
          throw new Error(`listRecords(${collection}) HTTP ${res.status}${serverMsg ? `: ${serverMsg}` : ''}`);
        }
        return res.data;
      }),
      cacheKey,
      params.noCache ? 0 : 30000,
  );
}

export async function getRecord(collection, id) {
  const token = await getAdminToken();
  const url   = `${BASE_URL}/api/collections/${collection}/records/${id}`;
  const cacheKey = makeCacheKey('GET', url, null);

  return cachedFetch(
      () => request('GET', url, token).then(res => {
        if (!res.ok) throw new Error(`getRecord(${collection}, ${id}) HTTP ${res.status}`);
        return res.data;
      }),
      cacheKey,
      15000,
  );
}

export async function createRecord(collection, data) {
  const token = await getAdminToken();
  const res   = await request(
      'POST',
      `${BASE_URL}/api/collections/${collection}/records`,
      token,
      data,
  );
  if (!res.ok) {
    const msg = parseErrors(res.data);
    throw new Error(msg || `createRecord failed: HTTP ${res.status}`);
  }
  invalidateCollection(collection);
  return res.data;
}

export async function updateRecord(collection, id, data) {
  const token = await getAdminToken();
  const res   = await request(
      'PATCH',
      `${BASE_URL}/api/collections/${collection}/records/${id}`,
      token,
      data,
  );
  if (!res.ok) {
    const msg = parseErrors(res.data);
    throw new Error(msg || `updateRecord failed: HTTP ${res.status}`);
  }
  invalidateCollection(collection);
  return res.data;
}

export async function deleteRecord(collection, id) {
  const token = await getAdminToken();
  const res   = await request(
      'DELETE',
      `${BASE_URL}/api/collections/${collection}/records/${id}`,
      token,
  );
  if (!res.ok) throw new Error(`deleteRecord failed: HTTP ${res.status}`);
  invalidateCollection(collection);
  return true;
}

// ── Collections (schemas) ──────────────────────────────────────────────────

export async function listCollections() {
  const token = await getSuperuserToken();
  const res   = await request('GET', `${BASE_URL}/api/collections?perPage=200`, token);
  if (!res.ok) throw new Error(`listCollections HTTP ${res.status}`);
  return res.data;
}

export async function listPcAgents() {
  return listRecords(COL_PC_AGENTS, {
    perPage: 100,
    sort: '-last_seen',
    noCache: true,
  });
}

export async function upsertPcAgent(recordId, payload) {
  const token   = await getServiceToken();
  const patchUrl = `${BASE_URL}/api/collections/${COL_PC_AGENTS}/records/${recordId}`;
  const postUrl  = `${BASE_URL}/api/collections/${COL_PC_AGENTS}/records`;

  const patchRes = await request('PATCH', patchUrl, token, payload);
  if (patchRes.ok) return patchRes.data;

  if (patchRes.status === 404) {
    const postRes = await request('POST', postUrl, token, payload);
    if (!postRes.ok) {
      const msg = parseErrors(postRes.data);
      throw new Error(msg || `upsertPcAgent POST failed: HTTP ${postRes.status}`);
    }
    return postRes.data;
  }

  const msg = parseErrors(patchRes.data);
  throw new Error(msg || `upsertPcAgent PATCH failed: HTTP ${patchRes.status}`);
}

export async function getCollection(nameOrId) {
  const token = await getSuperuserToken();
  const res   = await request('GET', `${BASE_URL}/api/collections/${nameOrId}`, token);
  if (!res.ok) throw new Error(`getCollection HTTP ${res.status}`);
  return res.data;
}

// ── User-specific operations ───────────────────────────────────────────────

export async function createUserFull({
                                       email, password, name, role, companyName, department, designation, phoneNumber = '',
                                     }) {
  const token = await getAdminToken();

  const userRes = await request(
      'POST',
      `${BASE_URL}/api/collections/${COL_USERS}/records`,
      token,
      { email, password, passwordConfirm: password, name, emailVisibility: true },
  );
  if (!userRes.ok) {
    const msg = parseErrors(userRes.data);
    throw new Error(msg || `Create user failed: HTTP ${userRes.status}`);
  }
  const userId       = userRes.data.id;
  const sc           = sanitize(companyName);
  const sd           = sanitize(department);
  const documentPath = `users/${sc}/${sd}/${role}/${userId}`;
  const permissions  = JSON.stringify(getPermissionsForRole(role));

  await request('PATCH', `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`, token, {
    userId, role, companyName, sanitizedCompanyName: sc,
    department, sanitizedDepartment: sd, designation, isActive: true,
    documentPath, permissions, needsProfileCompletion: true,
    profile: JSON.stringify({
      imageUrl: '', phoneNumber, address: '', employeeId: '',
      reportingTo: '', salary: 0,
      emergencyContactName: '', emergencyContactPhone: '', emergencyContactRelation: '',
    }),
    workStats: JSON.stringify({
      experience: 0, completedProjects: 0, activeProjects: 0,
      pendingTasks: 0, completedTasks: 0, totalWorkingHours: 0, avgPerformanceRating: 0.0,
    }),
    issues: JSON.stringify({ totalComplaints: 0, resolvedComplaints: 0, pendingComplaints: 0 }),
  });

  await request('POST', `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records`, token, {
    userId, name, email, companyName, sanitizedCompanyName: sc,
    department, sanitizedDepartment: sd, role, designation,
    permissions, isActive: true, documentPath, needsProfileCompletion: true,
  });

  const searchTerms = JSON.stringify(
      [name, email, companyName, department, role, designation]
          .map(s => s.toLowerCase()).filter(Boolean),
  );
  await request('POST', `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records`, token, {
    userId, name: name.toLowerCase(), email: email.toLowerCase(),
    companyName, sanitizedCompanyName: sc, department, sanitizedDepartment: sd,
    role, designation, isActive: true, searchTerms, documentPath,
  });

  invalidateCollection(COL_USERS);
  invalidateCollection(COL_ACCESS_CONTROL);
  invalidateCollection(COL_SEARCH_INDEX);

  return userId;
}

export async function toggleUserActive(userId, isActive) {
  const token = await getAdminToken();
  await request(
      'PATCH',
      `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`,
      token,
      { isActive },
  );

  const acRes = await request(
      'GET',
      `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`,
      token,
  );
  if (acRes.ok && acRes.data?.items?.length > 0) {
    const acId = acRes.data.items[0].id;
    await request(
        'PATCH',
        `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`,
        token,
        { isActive },
    );
  }
  invalidateCollection(COL_USERS);
  invalidateCollection(COL_ACCESS_CONTROL);
}

export async function changeUserRole(userId, newRole) {
  const token       = await getAdminToken();
  const permissions = JSON.stringify(getPermissionsForRole(newRole));
  await request(
      'PATCH',
      `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`,
      token,
      { role: newRole, permissions },
  );

  const acRes = await request(
      'GET',
      `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`,
      token,
  );
  if (acRes.ok && acRes.data?.items?.length > 0) {
    const acId = acRes.data.items[0].id;
    await request(
        'PATCH',
        `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`,
        token,
        { role: newRole, permissions },
    );
  }
  invalidateCollection(COL_USERS);
  invalidateCollection(COL_ACCESS_CONTROL);
}

export async function deleteUserFull(userId) {
  const token = await getAdminToken();

  const acRes = await request(
      'GET',
      `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`,
      token,
  );
  if (acRes.ok && acRes.data?.items?.length > 0) {
    await request(
        'DELETE',
        `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acRes.data.items[0].id}`,
        token,
    );
  }

  const siRes = await request(
      'GET',
      `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records?filter=(userId='${userId}')&perPage=1`,
      token,
  );
  if (siRes.ok && siRes.data?.items?.length > 0) {
    await request(
        'DELETE',
        `${BASE_URL}/api/collections/${COL_SEARCH_INDEX}/records/${siRes.data.items[0].id}`,
        token,
    );
  }

  await request(
      'DELETE',
      `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`,
      token,
  );

  invalidateCollection(COL_USERS);
  invalidateCollection(COL_ACCESS_CONTROL);
  invalidateCollection(COL_SEARCH_INDEX);
}

// ── Profile Operations ─────────────────────────────────────────────────────

export async function getUserRecord(userId, userToken = null) {
  const token = userToken || await getAdminToken();
  const url   = `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`;
  const res   = await request('GET', url, token);
  if (!res.ok) throw new Error(`getUserRecord(${userId}) HTTP ${res.status}`);
  return res.data;
}

export async function updateUserProfile(userId, profileData) {
  const token = await getAdminToken();
  const res   = await request(
      'PATCH',
      `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`,
      token,
      profileData,
  );
  if (!res.ok) {
    const msg = parseErrors(res.data);
    throw new Error(msg || `updateUserProfile failed: HTTP ${res.status}`);
  }
  invalidateCollection(COL_USERS);

  if (profileData.name || profileData.department || profileData.designation) {
    const acRes = await request(
        'GET',
        `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`,
        token,
    );
    if (acRes.ok && acRes.data?.items?.length > 0) {
      const acId    = acRes.data.items[0].id;
      const acUpdate = {};
      if (profileData.name)        acUpdate.name        = profileData.name;
      if (profileData.department)  acUpdate.department  = profileData.department;
      if (profileData.designation) acUpdate.designation = profileData.designation;
      await request(
          'PATCH',
          `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`,
          token,
          acUpdate,
      );
    }
    invalidateCollection(COL_ACCESS_CONTROL);
  }

  return res.data;
}

// ── Permission Operations ──────────────────────────────────────────────────

export async function updateUserPermissions(userId, permissions) {
  const token    = await getAdminToken();
  const permsJson = JSON.stringify(permissions);

  await request(
      'PATCH',
      `${BASE_URL}/api/collections/${COL_USERS}/records/${userId}`,
      token,
      { permissions: permsJson },
  );

  const acRes = await request(
      'GET',
      `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records?filter=(userId='${userId}')&perPage=1`,
      token,
  );
  if (acRes.ok && acRes.data?.items?.length > 0) {
    const acId = acRes.data.items[0].id;
    await request(
        'PATCH',
        `${BASE_URL}/api/collections/${COL_ACCESS_CONTROL}/records/${acId}`,
        token,
        { permissions: permsJson },
    );
  }

  invalidateCollection(COL_USERS);
  invalidateCollection(COL_ACCESS_CONTROL);
}

export async function batchUpdatePermissions(userIds, permissions) {
  const results = [];
  for (const userId of userIds) {
    try {
      await updateUserPermissions(userId, permissions);
      results.push({ userId, success: true });
    } catch (e) {
      results.push({ userId, success: false, error: e.message });
    }
  }
  return results;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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

function getPermissionsForRole(role) {
  const perms = {
    System_Administrator: [
      'create_user','delete_user','modify_user','view_all_users','manage_roles','view_analytics',
      'system_settings','manage_companies','access_all_data','export_data','manage_permissions',
      'access_admin_panel','submit_complaints','view_all_complaints','resolve_complaints',
      'database_manager','view_all_companies','manage_all_companies','edit_system_administrator',
      'grant_revoke_any_permission','manage_system_settings','view_audit_logs','remote_access',
    ],
    Administrator: [
      'create_user','delete_user','modify_user','view_all_users','manage_roles','view_analytics',
      'system_settings','manage_companies','access_all_data','export_data','manage_permissions',
      'access_admin_panel','submit_complaints','view_all_complaints','resolve_complaints','remote_access',
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
    Employee:    ['view_profile','edit_profile','view_assigned_projects','submit_reports','submit_complaints','view_own_complaints'],
    Intern:      ['view_profile','edit_basic_profile','view_assigned_tasks','submit_complaints'],
  };
  return perms[role] || ['view_profile'];
}

export { BASE_URL, sanitize, getPermissionsForRole };
