import { Bell, Search, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getInitials } from '../utils/helpers';

export default function Topbar() {
  const { auth } = useAuth();
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div>
          <h1>IT Connect</h1>
          <p>
            {auth?.companyName
              ? `${auth.companyName} — ${auth.department || 'Dashboard'}`
              : 'Administration Dashboard'
            }
          </p>
        </div>
      </div>
      <div className="topbar-right">
        <button className="topbar-btn" title="Search">
          <Search size={17} />
        </button>
        <button className="topbar-btn" title="Notifications">
          <Bell size={17} />
        </button>
        <button
          className="topbar-btn theme-toggle"
          title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
        </button>
        <div className="topbar-user">
          <div className="topbar-avatar">
            {getInitials(auth?.name || 'U')}
          </div>
          <div className="topbar-user-info">
            <span className="topbar-user-name">{auth?.name || 'User'}</span>
            <span className="topbar-user-role">{auth?.role?.replace(/_/g, ' ') || 'User'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
