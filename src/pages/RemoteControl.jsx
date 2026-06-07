import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Monitor, Wifi, WifiOff, Lock, Moon, Camera, Volume2, VolumeX,
  Power, RotateCcw, Settings, Keyboard, RefreshCw, Zap, Activity,
  ArrowDown, Layout, Globe, Image, Shield, ZoomIn, ZoomOut, RotateCcw as ResetIcon
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import { executeQuickStep, captureScreen, getScreenStreamUrl } from '../api/pcControlApi';
import { useToast } from '../context/ToastContext';
import AdminControl from '../components/AdminControl';
import { listPcAgents } from '../api/pocketbase';

const QUICK_ACTIONS = [
  { id: 'LOCK',          label: 'Lock PC',       icon: Lock,      color: 'blue'    },
  { id: 'SLEEP',         label: 'Sleep',          icon: Moon,      color: 'purple'  },
  { id: 'MUTE',          label: 'Mute',           icon: VolumeX,   color: 'amber'   },
  { id: 'VOLUME_UP',     label: 'Volume +',       icon: Volume2,   color: 'emerald' },
  { id: 'VOLUME_DOWN',   label: 'Volume −',       icon: ArrowDown, color: 'emerald' },
  { id: 'SCREENSHOT',    label: 'Screenshot',     icon: Camera,    color: 'cyan'    },
  { id: 'SHUTDOWN',      label: 'Shutdown',       icon: Power,     color: 'rose'    },
  { id: 'RESTART',       label: 'Restart',        icon: RotateCcw, color: 'amber'   },
  { id: 'TASK_MANAGER',  label: 'Task Manager',   icon: Activity,  color: 'blue'    },
  { id: 'SETTINGS',      label: 'Settings',       icon: Settings,  color: 'purple'  },
  { id: 'CONTROL_PANEL', label: 'Control Panel',  icon: Layout,    color: 'cyan'    },
];

const WIN_SHORTCUTS = [
  { key: 'WIN+D',          label: 'Desktop'    },
  { key: 'WIN+E',          label: 'Explorer'   },
  { key: 'WIN+L',          label: 'Lock'       },
  { key: 'WIN+R',          label: 'Run'        },
  { key: 'WIN+I',          label: 'Settings'   },
  { key: 'WIN+TAB',        label: 'Task View'  },
  { key: 'ALT+TAB',        label: 'Switch App' },
  { key: 'ALT+F4',         label: 'Close App'  },
  { key: 'CTRL+SHIFT+ESC', label: 'Task Mgr'   },
  { key: 'WIN+S',          label: 'Search'     },
];

// Agent online: status=online AND last_seen within 120s (8 missed heartbeats tolerance)
function isAgentOnline(agent) {
  const lastSeen = Date.parse(agent.last_seen || agent.updated || '');
  if (!lastSeen) return agent.status === 'online';
  return agent.status === 'online' && Date.now() - lastSeen < 120_000;
}

function formatLastSeen(value) {
  const ts = Date.parse(value || '');
  if (!ts) return 'unknown';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5)  return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}

export default function RemoteControlPage() {
  const {
    settings, updateSettings, baseUrl,
    connected, pcName, pinging, connectionError, doPing,
  } = usePcControl();
  const { addToast } = useToast();

  const [formIp,  setFormIp]  = useState(settings.ip);
  const [formPort, setFormPort] = useState(settings.port);
  const [formKey, setFormKey] = useState(settings.secretKey);

  // Screen preview state
  const [screenImg, setScreenImg]     = useState(null);
  const [screenQuality, setScreenQuality] = useState('1080p');
  const [loadingScreen, setLoadingScreen] = useState(false);
  const [screenZoom, setScreenZoom]   = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const [actionLoading, setActionLoading] = useState('');
  const [showAdminControl, setShowAdminControl] = useState(false);

  // PC Registry
  const [agents, setAgents]             = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError]   = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [agentPassword, setAgentPassword] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);

  // Background polling — agents poll silently every 15s
  const agentsPollRef  = useRef(null);
  const screenPollRef  = useRef(null);
  const isPollRunning  = useRef(false);

  // Sync form fields when settings change
  useEffect(() => {
    setFormIp(settings.ip);
    setFormPort(settings.port);
    setFormKey(settings.secretKey);
  }, [settings]);

  // ── PC Registry polling (background, every 15s) ───────────────────────────
  const loadAgents = useCallback(async (silent = false) => {
    if (isPollRunning.current && silent) return; // skip if already running
    isPollRunning.current = true;
    if (!silent) setAgentsLoading(true);
    try {
      const res   = await listPcAgents();
      const items = Array.isArray(res?.items) ? res.items : [];
      setAgents(items);
      setAgentsError('');
      setLastRefreshed(new Date());
      // Auto-select first online PC if nothing selected
      if (!selectedAgentId) {
        const firstOnline = items.find(isAgentOnline);
        if (firstOnline) setSelectedAgentId(firstOnline.id);
      }
    } catch (e) {
      const msg = e.message || 'Unable to load PCs from PocketBase.';
      if (!silent) {
        setAgentsError(
            msg.includes('Session expired') || msg.includes('not logged in')
                ? 'Session expired — please log in again.'
                : msg + ' — ensure pc_agents collection exists.',
        );
      }
    } finally {
      if (!silent) setAgentsLoading(false);
      isPollRunning.current = false;
    }
  }, [selectedAgentId]);

  useEffect(() => {
    loadAgents(false); // initial load — show spinner
    agentsPollRef.current = setInterval(() => loadAgents(true), 15_000); // 15s silent background poll
    return () => clearInterval(agentsPollRef.current);
  }, [loadAgents]);

  // ── Auto-refresh screen preview every 15s (if enabled) ────────────────────
  const captureScreenSilent = useCallback(async () => {
    if (!connected || loadingScreen) return;
    const QUALITY_MAP = { '720p': [40, 4], '1080p': [65, 2], '2K': [80, 1] };
    const [q, s] = QUALITY_MAP[screenQuality] || [65, 2];
    try {
      const res = await captureScreen(baseUrl, settings.secretKey, q, s);
      if (res.ok && res.data?.data) {
        setScreenImg('data:image/jpeg;base64,' + res.data.data);
      }
    } catch { /* silent */ }
  }, [connected, baseUrl, settings.secretKey, screenQuality, loadingScreen]);

  useEffect(() => {
    clearInterval(screenPollRef.current);
    if (autoRefresh && connected) {
      screenPollRef.current = setInterval(captureScreenSilent, 15_000);
    }
    return () => clearInterval(screenPollRef.current);
  }, [autoRefresh, connected, captureScreenSilent]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  function handleConnectAgent(e) {
    e?.preventDefault();
    const agent = agents.find(item => item.id === selectedAgentId);
    if (!agent) { addToast('Select a running PC', 'error'); return; }
    if (!agentPassword.trim()) { addToast('Enter the PC agent password', 'error'); return; }
    const ip   = agent.ip;
    const port = Number(agent.command_port || 5000);
    if (!ip) { addToast('Selected PC has no IP address', 'error'); return; }
    setFormIp(ip);
    setFormPort(port);
    setFormKey(agentPassword.trim());
    updateSettings({ ip, port, secretKey: agentPassword.trim() });
    addToast(`Connecting to ${agent.pc_name || agent.hostname || ip}…`, 'info');
  }

  function handleConnect(e) {
    e?.preventDefault();
    if (!formIp.trim()) { addToast('Enter PC IP address', 'error'); return; }
    updateSettings({
      ip:        formIp.trim(),
      port:      Number(formPort) || 5000,
      secretKey: formKey.trim() || 'changeme',
    });
    addToast('Connecting to ' + formIp.trim() + '…', 'info');
  }

  async function handleQuickAction(cmdId) {
    if (!connected) { addToast('Not connected to PC', 'error'); return; }
    setActionLoading(cmdId);
    try {
      const res = await executeQuickStep(baseUrl, settings.secretKey, { type: 'SYSTEM_CMD', value: cmdId });
      if (res.ok) addToast(`${cmdId} executed`, 'success');
      else        addToast(`Failed: ${res.data?.error || 'Unknown error'}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleKeyShortcut(key) {
    if (!connected) { addToast('Not connected', 'error'); return; }
    setActionLoading(key);
    try {
      const res = await executeQuickStep(baseUrl, settings.secretKey, { type: 'KEY_PRESS', value: key });
      if (res.ok) addToast(`Sent ${key}`, 'success');
      else        addToast(`Failed: ${res.data?.error || 'Unknown error'}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleCaptureScreen() {
    if (!connected) { addToast('Not connected', 'error'); return; }
    setLoadingScreen(true);
    try {
      const QUALITY_MAP = { '720p': [40, 4], '1080p': [65, 2], '2K': [80, 1] };
      const [q, s] = QUALITY_MAP[screenQuality] || [65, 2];
      const res = await captureScreen(baseUrl, settings.secretKey, q, s);
      if (res.ok && res.data?.data) {
        setScreenImg('data:image/jpeg;base64,' + res.data.data);
      } else {
        addToast('Failed to capture screen', 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoadingScreen(false);
    }
  }

  if (showAdminControl && connected) {
    return <AdminControl onExit={() => setShowAdminControl(false)} />;
  }

  const onlineAgents  = agents.filter(isAgentOnline);
  const selectedAgent = agents.find(item => item.id === selectedAgentId);

  return (
      <div className="animate-in">
        {/* Page header */}
        <div className="page-header">
          <div>
            <h1>Remote Control</h1>
            <p>Connect to and control any Windows PC on your network</p>
          </div>
          <div className="page-header-actions">
            {connected && (
                <button className="btn btn-admin-control" onClick={() => setShowAdminControl(true)}>
                  <Shield size={16} /> Admin Control
                </button>
            )}
            <div className={`badge ${connected ? 'badge-emerald' : 'badge-rose'}`}>
              <span className="badge-dot" />
              {connected ? `Connected — ${pcName}` : 'Disconnected'}
            </div>
          </div>
        </div>

        {/* PC Registry */}
        <div className="card rc-agent-registry">
          <div className="rc-agent-header">
            <div>
              <h3><Globe size={18} /> Running PCs — AI Server Registry</h3>
              <p>
                Agents report every 15s · UI refreshes every 15s in background
                {lastRefreshed && <span style={{ color: 'var(--text-tertiary)', marginLeft: 8, fontSize: '0.75rem' }}>
                · Updated {formatLastSeen(lastRefreshed.toISOString())}
              </span>}
              </p>
            </div>
            <button
                className="btn btn-outline btn-sm"
                onClick={() => loadAgents(false)}
                disabled={agentsLoading}
            >
              <RefreshCw size={14} /> {agentsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {agentsError && <div className="rc-agent-error">{agentsError}</div>}

          {onlineAgents.length > 0 ? (
              <form className="rc-agent-connect" onSubmit={handleConnectAgent}>
                <div className="rc-agent-list">
                  {onlineAgents.map(agent => {
                    const active = selectedAgentId === agent.id;
                    return (
                        <button
                            type="button"
                            key={agent.id}
                            className={`rc-agent-card ${active ? 'active' : ''}`}
                            onClick={() => setSelectedAgentId(agent.id)}
                        >
                          <div className="rc-agent-card-top">
                      <span className="badge badge-emerald">
                        <span className="badge-dot" /> Online
                      </span>
                            <span className="rc-agent-last">{formatLastSeen(agent.last_seen || agent.updated)}</span>
                          </div>
                          <strong>{agent.pc_name || agent.hostname || 'Windows PC'}</strong>
                          <span>{agent.ip}:{agent.command_port || 5000}</span>
                          <small>{agent.username || 'unknown'} · stream :{agent.stream_port || 5001}</small>
                        </button>
                    );
                  })}
                </div>

                <div className="rc-agent-password-row">
                  <div className="input-group">
                    <label>Agent Password</label>
                    <input
                        className="input"
                        type="password"
                        value={agentPassword}
                        onChange={e => setAgentPassword(e.target.value)}
                        placeholder="Enter selected PC secret key"
                        autoComplete="current-password"
                    />
                  </div>
                  <button
                      type="submit"
                      className="btn btn-primary"
                      disabled={!selectedAgent || !agentPassword.trim()}
                  >
                    <Wifi size={16} /> Connect Selected PC
                  </button>
                </div>
              </form>
          ) : (
              <div className="rc-agent-empty">
                <Monitor size={28} />
                <span>
              {agentsLoading
                  ? 'Loading running PCs…'
                  : 'No running PCs reported in the last 2 minutes.'}
            </span>
              </div>
          )}
        </div>

        {/* Manual connection + Status */}
        <div className="detail-grid" style={{ marginBottom: 24 }}>
          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: '0.95rem' }}>
              {connected
                  ? <Wifi size={18} style={{ color: 'var(--accent-emerald)' }} />
                  : <WifiOff size={18} style={{ color: 'var(--accent-rose)' }} />}
              Connection Settings
            </h3>
            <form onSubmit={handleConnect}>
              <div className="form-grid">
                <div className="input-group">
                  <label>PC IP Address</label>
                  <input
                      className="input"
                      value={formIp}
                      onChange={e => setFormIp(e.target.value)}
                      placeholder="192.168.1.100"
                      autoComplete="off"
                  />
                </div>
                <div className="input-group">
                  <label>Port</label>
                  <input
                      className="input"
                      type="number"
                      value={formPort}
                      onChange={e => setFormPort(e.target.value)}
                      placeholder="5000"
                      min="1"
                      max="65535"
                  />
                </div>
                <div className="input-group">
                  <label>Secret Key</label>
                  <input
                      className="input"
                      type="password"
                      value={formKey}
                      onChange={e => setFormKey(e.target.value)}
                      placeholder="Secret key"
                      autoComplete="current-password"
                  />
                </div>
                <div className="input-group" style={{ justifyContent: 'flex-end' }}>
                  <button type="submit" className="btn btn-primary" disabled={pinging}>
                    {pinging
                        ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Connecting…</>
                        : <><Wifi size={16} /> Connect</>}
                  </button>
                </div>
              </div>
            </form>
          </div>

          <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: '0.95rem' }}>
              <Monitor size={18} /> PC Status
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="rc-status-item">
                <span className="rc-status-label">Status</span>
                <span className={`badge ${connected ? 'badge-emerald' : 'badge-rose'}`}>
                <span className="badge-dot" />{connected ? 'Online' : 'Offline'}
              </span>
              </div>
              <div className="rc-status-item">
                <span className="rc-status-label">PC Name</span>
                <span className="rc-status-value">{pcName || '—'}</span>
              </div>
              <div className="rc-status-item">
                <span className="rc-status-label">Address</span>
                <span className="rc-status-value" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                {settings.ip ? `${settings.ip}:${settings.port}` : '—'}
              </span>
              </div>
              <div className="rc-status-item">
                <span className="rc-status-label">Actions</span>
                <button className="btn btn-outline btn-sm" onClick={doPing} disabled={pinging || !settings.ip}>
                  <RefreshCw size={14} /> Ping
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Connected features */}
        {connected && (
            <>
              {/* Quick Actions */}
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Zap size={18} style={{ color: 'var(--accent-amber)' }} /> Quick Actions
              </h2>
              <div className="rc-actions-grid" style={{ marginBottom: 24 }}>
                {QUICK_ACTIONS.map(action => {
                  const Icon = action.icon;
                  return (
                      <button
                          key={action.id}
                          className={`rc-action-btn ${action.color}`}
                          onClick={() => handleQuickAction(action.id)}
                          disabled={actionLoading === action.id}
                      >
                        <div className={`rc-action-icon ${action.color}`}>
                          {actionLoading === action.id
                              ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                              : <Icon size={20} />}
                        </div>
                        <span>{action.label}</span>
                      </button>
                  );
                })}
              </div>

              {/* Keyboard Shortcuts */}
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Keyboard size={18} style={{ color: 'var(--accent-blue)' }} /> Keyboard Shortcuts
              </h2>
              <div className="rc-shortcuts-grid" style={{ marginBottom: 24 }}>
                {WIN_SHORTCUTS.map(s => (
                    <button
                        key={s.key}
                        className="rc-shortcut-btn"
                        onClick={() => handleKeyShortcut(s.key)}
                        disabled={actionLoading === s.key}
                    >
                      <code>{s.key}</code>
                      <span>{s.label}</span>
                    </button>
                ))}
              </div>

              {/* Screen Preview */}
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Image size={18} style={{ color: 'var(--accent-purple)' }} /> Screen Preview
              </h2>
              <div className="card" style={{ marginBottom: 24 }}>
                {/* Controls row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {/* Quality selector */}
                    <div style={{ display: 'flex', gap: 4 }}>
                      {['720p', '1080p', '2K'].map(q => (
                          <button
                              key={q}
                              className={`q-btn ${screenQuality === q ? 'q-btn-active' : ''}`}
                              onClick={() => setScreenQuality(q)}
                          >{q}</button>
                      ))}
                    </div>
                    {/* Auto-refresh toggle */}
                    <button
                        className={`q-btn ${autoRefresh ? 'q-btn-active' : ''}`}
                        onClick={() => setAutoRefresh(v => !v)}
                        title="Auto-refresh every 15s"
                    >
                      <RefreshCw size={12} /> {autoRefresh ? 'Live (15s)' : 'Auto Refresh'}
                    </button>
                    {/* Zoom controls */}
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button className="q-btn" onClick={() => setScreenZoom(z => Math.max(0.5, z - 0.25))} title="Zoom Out"><ZoomOut size={12} /></button>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', minWidth: 36, textAlign: 'center' }}>{Math.round(screenZoom * 100)}%</span>
                      <button className="q-btn" onClick={() => setScreenZoom(z => Math.min(4, z + 0.25))} title="Zoom In"><ZoomIn size={12} /></button>
                      <button className="q-btn" onClick={() => setScreenZoom(1)} title="Reset Zoom"><ResetIcon size={12} /></button>
                    </div>
                  </div>
                  <button
                      className="btn btn-primary btn-sm"
                      onClick={handleCaptureScreen}
                      disabled={loadingScreen}
                  >
                    {loadingScreen
                        ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Capturing…</>
                        : <><Camera size={14} /> Capture {screenQuality}</>}
                  </button>
                </div>

                {/* Screen image box */}
                {screenImg ? (
                    <div
                        className="rc-screen-preview"
                        style={{ overflow: 'auto', maxHeight: 600, background: '#000', borderRadius: 8, border: '1px solid var(--border-subtle)' }}
                    >
                      <img
                          src={screenImg}
                          alt="Remote Screen"
                          style={{
                            display: 'block',
                            width: `${screenZoom * 100}%`,
                            imageRendering: screenZoom > 1 ? 'pixelated' : 'auto',
                            cursor: 'crosshair',
                          }}
                      />
                    </div>
                ) : (
                    <div className="rc-screen-empty">
                      <Monitor size={48} style={{ opacity: 0.3 }} />
                      <p>Click "Capture" to preview the remote desktop</p>
                      <small style={{ color: 'var(--text-tertiary)' }}>Supports 720p, 1080p, 2K quality</small>
                    </div>
                )}
              </div>
            </>
        )}

        {/* Error / no config banners */}
        {!connected && settings.ip && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <WifiOff size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
              <h3 style={{ marginBottom: 8 }}>Unable to Connect</h3>
              <p style={{ color: 'var(--text-tertiary)', maxWidth: 400, margin: '0 auto' }}>
                {connectionError || 'Ensure the IT Connect Agent is running on the target PC and the IP is correct.'}
              </p>
            </div>
        )}
        {!settings.ip && (
            <div className="card" style={{ textAlign: 'center', padding: 48 }}>
              <Monitor size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
              <h3 style={{ marginBottom: 8 }}>No PC Configured</h3>
              <p style={{ color: 'var(--text-tertiary)', maxWidth: 400, margin: '0 auto' }}>
                Select a running PC from the registry above, or enter an IP address manually.
              </p>
            </div>
        )}
      </div>
  );
}