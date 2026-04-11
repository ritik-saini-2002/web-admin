import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Users, ShieldCheck, Building2, FolderTree,
  Database, RefreshCw, ChevronLeft, ChevronRight, LogOut,
  Monitor, MousePointer, FolderOpen, Package
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { usePcControl } from '../context/PcControlContext';

/**
 * Navigation items with optional `requiredPermission`.
 * If no permission listed, the item is visible to everyone.
 */
const navItems = [
  { section: 'Overview' },
  { path: '/',            icon: LayoutDashboard, label: 'Dashboard' },
  { section: 'Management' },
  { path: '/users',       icon: Users,          label: 'Users',            requiredPermission: 'view_all_users' },
  { path: '/roles',       icon: ShieldCheck,    label: 'Roles',            requiredPermission: 'manage_roles' },
  { path: '/departments', icon: FolderTree,     label: 'Departments',      requiredPermission: 'view_all_users' },
  { path: '/companies',   icon: Building2,      label: 'Companies',        requiredPermission: 'manage_companies' },
  { section: 'System' },
  { path: '/database',    icon: Database,       label: 'Database Manager', requiredPermission: 'database_manager' },
  { path: '/sync',        icon: RefreshCw,      label: 'Sync Queue',       requiredPermission: 'system_settings' },
  { section: 'PC Control' },
  { path: '/remote',      icon: Monitor,        label: 'Remote Control' },
  { path: '/touchpad',    icon: MousePointer,   label: 'Touchpad & Keys' },
  { path: '/files',       icon: FolderOpen,     label: 'File Browser' },
  { path: '/apps',        icon: Package,        label: 'App Directory' },
];

export default function Sidebar({ collapsed, onToggle }) {
  const { logout, auth, hasPermission } = useAuth();
  const location = useLocation();

  let pcConnected = false;
  try {
    const pc = usePcControl();
    pcConnected = pc?.connected || false;
  } catch {}

  // Filter nav items based on permissions
  const visibleItems = navItems.filter(item => {
    if (item.section) return true;  // section headers always checked below
    if (!item.requiredPermission) return true;
    return hasPermission(item.requiredPermission);
  });

  // Remove section headers that have no visible items after them
  const filteredItems = visibleItems.filter((item, idx) => {
    if (!item.section) return true;
    // Check if there's at least one non-section item after this before the next section
    for (let j = idx + 1; j < visibleItems.length; j++) {
      if (visibleItems[j].section) return false;
      return true;
    }
    return false;
  });

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">IT</div>
        <div className="sidebar-brand">
          <span>IT Connect</span>
          <span>Admin Panel</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {filteredItems.map((item, i) => {
          if (item.section) {
            return <div key={i} className="sidebar-section-title">{item.section}</div>;
          }
          const Icon = item.icon;
          const isActive = location.pathname === item.path ||
            (item.path !== '/' && location.pathname.startsWith(item.path));
          const isPcItem = ['/remote', '/touchpad', '/files', '/apps'].includes(item.path);
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-item-icon"><Icon size={19} /></span>
              <span className="nav-item-label">{item.label}</span>
              {isPcItem && pcConnected && !collapsed && (
                <span className="nav-item-badge" style={{ background: 'var(--accent-emerald)', fontSize: '0.6rem', padding: '1px 5px' }}>●</span>
              )}
            </NavLink>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        {/* Show current user role */}
        {!collapsed && auth && (
          <div className="sidebar-user-info">
            <span className="sidebar-user-name">{auth.name}</span>
            <span className="sidebar-user-role">{auth.role?.replace(/_/g, ' ')}</span>
          </div>
        )}
        <button className="nav-item" onClick={logout} style={{ width: '100%', color: 'var(--accent-rose)' }}>
          <span className="nav-item-icon"><LogOut size={19} /></span>
          <span className="nav-item-label">Logout</span>
        </button>
        <button className="sidebar-toggle" onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
