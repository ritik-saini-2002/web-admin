import { useState, useEffect, useCallback } from 'react';
import {
  Package, Play, X, Search, RefreshCw, Activity, Power,
  Monitor, ExternalLink, Minimize2, Maximize2
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  getInstalledApps, getProcesses, launchApp, killApp,
  minimizeApp, restoreApp
} from '../api/pcControlApi';
import { useToast } from '../context/ToastContext';

export default function AppDirectoryPage() {
  const { settings, baseUrl, connected, pcName } = usePcControl();
  const { addToast } = useToast();

  const [tab, setTab] = useState('apps'); // apps | processes
  const [apps, setApps] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [actionLoading, setActionLoading] = useState('');

  useEffect(() => {
    if (connected) {
      if (tab === 'apps') loadApps();
      else loadProcesses();
    }
  }, [connected, tab]);

  async function loadApps() {
    setLoading(true);
    try {
      const res = await getInstalledApps(baseUrl, settings.secretKey);
      if (res.ok && Array.isArray(res.data)) {
        setApps(res.data);
      } else {
        addToast('Failed to load apps', 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadProcesses() {
    setLoading(true);
    try {
      const res = await getProcesses(baseUrl, settings.secretKey);
      if (res.ok && res.data) {
        const procs = res.data.processes || res.data;
        if (Array.isArray(procs)) {
          setProcesses(procs);
        }
      } else {
        addToast('Failed to load processes', 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunch(app) {
    setActionLoading(app.name);
    try {
      const res = await launchApp(baseUrl, settings.secretKey, app.exePath);
      if (res.ok) addToast(`Launched ${app.name}`, 'success');
      else addToast(`Failed to launch: ${res.error || 'Unknown'}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleKill(name) {
    setActionLoading(name);
    try {
      const res = await killApp(baseUrl, settings.secretKey, name);
      if (res.ok) {
        addToast(`Killed ${name}`, 'success');
        if (tab === 'processes') loadProcesses();
        else loadApps();
      } else {
        addToast(`Failed: ${res.error || 'Unknown'}`, 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleMinimize(name) {
    try {
      await minimizeApp(baseUrl, settings.secretKey, name);
      addToast(`Minimized ${name}`, 'success');
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  async function handleRestore(name) {
    try {
      await restoreApp(baseUrl, settings.secretKey, name);
      addToast(`Restored ${name}`, 'success');
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  const filteredApps = apps.filter(a =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.exePath && a.exePath.toLowerCase().includes(search.toLowerCase()))
  );

  const filteredProcesses = typeof processes[0] === 'string'
    ? processes.filter(p => !search || p.toLowerCase().includes(search.toLowerCase()))
    : processes;

  if (!connected) {
    return (
      <div className="animate-in">
        <div className="page-header"><div><h1>App Directory</h1><p>Manage installed applications</p></div></div>
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Package size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>Not Connected</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>Go to Remote Control and connect to a PC first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>App Directory</h1>
          <p>{pcName} — {tab === 'apps' ? `${apps.length} installed apps` : `${processes.length} running processes`}</p>
        </div>
        <div className="page-header-actions">
          <div className="tabs" style={{ marginBottom: 0 }}>
            <button className={`tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>
              <Package size={14} /> Apps
            </button>
            <button className={`tab ${tab === 'processes' ? 'active' : ''}`} onClick={() => setTab('processes')}>
              <Activity size={14} /> Processes
            </button>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => tab === 'apps' ? loadApps() : loadProcesses()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="table-container">
        <div className="table-toolbar">
          <div className="search-box" style={{ minWidth: 300 }}>
            <Search size={16} />
            <input
              placeholder={tab === 'apps' ? 'Search installed apps...' : 'Search processes...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
            {tab === 'apps' ? `${filteredApps.length} apps` : `${filteredProcesses.length} processes`}
          </span>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading...</span></div>
        ) : tab === 'apps' ? (
          /* Apps List */
          filteredApps.length === 0 ? (
            <div className="empty-state">
              <Package size={48} /><h3>No apps found</h3>
              <p>Try a different search term or refresh.</p>
            </div>
          ) : (
            <div className="ad-apps-grid">
              {filteredApps.map((app, i) => (
                <div key={i} className="ad-app-card">
                  <div className="ad-app-icon">
                    <span style={{ fontSize: '1.6rem' }}>{app.icon || '📦'}</span>
                  </div>
                  <div className="ad-app-info">
                    <div className="ad-app-name">{app.name}</div>
                    <div className="ad-app-path" title={app.exePath}>{app.exePath}</div>
                    {app.isRunning && <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>Running</span>}
                  </div>
                  <div className="ad-app-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleLaunch(app)}
                      disabled={actionLoading === app.name}
                      title="Launch"
                    >
                      {actionLoading === app.name ? <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Play size={14} />}
                    </button>
                    {app.isRunning && (
                      <>
                        <button className="btn btn-outline btn-sm btn-icon" onClick={() => handleMinimize(app.name)} title="Minimize">
                          <Minimize2 size={14} />
                        </button>
                        <button className="btn btn-outline btn-sm btn-icon" onClick={() => handleRestore(app.name)} title="Restore">
                          <Maximize2 size={14} />
                        </button>
                        <button className="btn btn-ghost btn-sm btn-icon" onClick={() => handleKill(app.name)} title="Kill">
                          <X size={14} style={{ color: 'var(--accent-rose)' }} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Process List */
          filteredProcesses.length === 0 ? (
            <div className="empty-state">
              <Activity size={48} /><h3>No processes found</h3>
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Process Name</th>
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProcesses.map((proc, i) => {
                    const name = typeof proc === 'string' ? proc : proc.name || proc;
                    return (
                      <tr key={i}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Activity size={14} style={{ color: 'var(--accent-emerald)', flexShrink: 0 }} />
                            <span>{name}</span>
                          </div>
                        </td>
                        <td>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Kill Process"
                            onClick={() => handleKill(name)}
                            disabled={actionLoading === name}
                          >
                            {actionLoading === name ?
                              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> :
                              <Power size={14} style={{ color: 'var(--accent-rose)' }} />
                            }
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  );
}
