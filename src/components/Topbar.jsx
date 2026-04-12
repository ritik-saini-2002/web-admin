import { useState, useRef, useEffect } from 'react';
import { Bell, Search, Sun, Moon, User, LogOut, Settings, ChevronDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getInitials } from '../utils/helpers';

export default function Topbar() {
  const { auth, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

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

        {/* User profile button with dropdown */}
        <div className="topbar-user-wrapper" ref={dropdownRef}>
          <div
            className="topbar-user"
            onClick={() => setShowDropdown(v => !v)}
          >
            <div className="topbar-avatar">
              {getInitials(auth?.name || 'U')}
            </div>
            <div className="topbar-user-info">
              <span className="topbar-user-name">{auth?.name || 'User'}</span>
              <span className="topbar-user-role">{auth?.role?.replace(/_/g, ' ') || 'User'}</span>
            </div>
            <ChevronDown size={14} style={{ color: 'var(--text-tertiary)', transition: 'transform 0.2s', transform: showDropdown ? 'rotate(180deg)' : '' }} />
          </div>

          {showDropdown && (
            <div className="topbar-dropdown">
              <div className="topbar-dropdown-header">
                <div className="topbar-dropdown-avatar">
                  {getInitials(auth?.name || 'U')}
                </div>
                <div>
                  <div className="topbar-dropdown-name">{auth?.name || 'User'}</div>
                  <div className="topbar-dropdown-email">{auth?.email}</div>
                </div>
              </div>
              <div className="topbar-dropdown-divider" />
              <button className="topbar-dropdown-item" onClick={() => { setShowDropdown(false); navigate('/profile'); }}>
                <User size={15} /> My Profile
              </button>
              <button className="topbar-dropdown-item" onClick={() => { setShowDropdown(false); toggleTheme(); }}>
                {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
              </button>
              <div className="topbar-dropdown-divider" />
              <button className="topbar-dropdown-item danger" onClick={() => { setShowDropdown(false); logout(); }}>
                <LogOut size={15} /> Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
