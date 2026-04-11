import { useState, useEffect, useCallback } from 'react';
import {
  Monitor, Wifi, WifiOff, Lock, Moon, Camera, Volume2, VolumeX,
  Power, RotateCcw, Settings, Keyboard, RefreshCw, Zap, Activity,
  ArrowUp, ArrowDown, Layout, Terminal, Globe, Image, Shield
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  executeQuickStep, captureScreen, getProcesses,
  PC_SYSTEM_COMMANDS
} from '../api/pcControlApi';
import { useToast } from '../context/ToastContext';
import AdminControl from '../components/AdminControl';

const QUICK_ACTIONS = [
  { id: 'LOCK',         label: 'Lock PC',       icon: Lock,      color: 'blue' },
  { id: 'SLEEP',        label: 'Sleep',          icon: Moon,      color: 'purple' },
  { id: 'MUTE',         label: 'Mute',           icon: VolumeX,   color: 'amber' },
  { id: 'VOLUME_UP',    label: 'Volume +',       icon: Volume2,   color: 'emerald' },
  { id: 'VOLUME_DOWN',  label: 'Volume −',       icon: ArrowDown,  color: 'emerald' },
  { id: 'SCREENSHOT',   label: 'Screenshot',     icon: Camera,    color: 'cyan' },
  { id: 'SHUTDOWN',     label: 'Shutdown',        icon: Power,     color: 'rose' },
  { id: 'RESTART',      label: 'Restart',         icon: RotateCcw, color: 'amber' },
  { id: 'TASK_MANAGER', label: 'Task Manager',    icon: Activity,  color: 'blue' },
  { id: 'SETTINGS',     label: 'Settings',        icon: Settings,  color: 'purple' },
  { id: 'CONTROL_PANEL',label: 'Control Panel',   icon: Layout,    color: 'cyan' },
];

const WIN_SHORTCUTS = [
  { key: 'WIN+D',   label: 'Desktop' },
  { key: 'WIN+E',   label: 'Explorer' },
  { key: 'WIN+L',   label: 'Lock' },
  { key: 'WIN+R',   label: 'Run' },
  { key: 'WIN+I',   label: 'Settings' },
  { key: 'WIN+TAB', label: 'Task View' },
  { key: 'ALT+TAB', label: 'Switch App' },
  { key: 'ALT+F4',  label: 'Close App' },
  { key: 'CTRL+SHIFT+ESC', label: 'Task Mgr' },
  { key: 'WIN+S',   label: 'Search' },
];

export default function RemoteControlPage() {
  const { settings, updateSettings, baseUrl, connected, pcName, pinging, doPing } = usePcControl();
  const { addToast } = useToast();
  const [formIp, setFormIp] = useState(settings.ip);
  const [formPort, setFormPort] = useState(settings.port);
  const [formKey, setFormKey] = useState(settings.secretKey);
  const [screenImg, setScreenImg] = useState(null);
  const [loadingScreen, setLoadingScreen] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [showAdminControl, setShowAdminControl] = useState(false);

  useEffect(() => {
    setFormIp(settings.ip);
    setFormPort(settings.port);
    setFormKey(settings.secretKey);
  }, [settings]);

  function handleConnect(e) {
    e?.preventDefault();
    if (!formIp.trim()) { addToast('Enter PC IP address', 'error'); return; }
    updateSettings({ ip: formIp.trim(), port: Number(formPort) || 5000, secretKey: formKey.trim() || 'Ritik@2002' });
    addToast('Connecting to ' + formIp.trim() + '...', 'info');
  }

  async function handleQuickAction(cmdId) {
    if (!connected) { addToast('Not connected to PC', 'error'); return; }
    setActionLoading(cmdId);
    try {
      const res = await executeQuickStep(baseUrl, settings.secretKey, { type: 'SYSTEM_CMD', value: cmdId });
      if (res.ok) addToast(`${cmdId} executed`, 'success');
      else addToast(`Failed: ${res.error || res.data?.message || 'Unknown error'}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleKeyShortcut(key) {
    if (!connected) { addToast('Not connected to PC', 'error'); return; }
    setActionLoading(key);
    try {
      const res = await executeQuickStep(baseUrl, settings.secretKey, { type: 'KEY_PRESS', value: key });
      if (res.ok) addToast(`Sent ${key}`, 'success');
      else addToast(`Failed: ${res.error || 'Unknown error'}`, 'error');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setActionLoading('');
    }
  }

  async function handleCaptureScreen() {
    if (!connected) { addToast('Not connected to PC', 'error'); return; }
    setLoadingScreen(true);
    try {
      const res = await captureScreen(baseUrl, settings.secretKey, 40, 3);
      if (res.ok && res.data?.image) {
        setScreenImg('data:image/jpeg;base64,' + res.data.image);
      } else {
        addToast('Failed to capture screen', 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoadingScreen(false);
    }
  }

  // ── Admin Control Mode ──
  if (showAdminControl && connected) {
    return <AdminControl onExit={() => setShowAdminControl(false)} />;
  }

  return (
    <div className="animate-in">
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

      {/* Connection Setup */}
      <div className="detail-grid" style={{ marginBottom: 24 }}>
        <div className="card">
          <h3 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: '0.95rem' }}>
            {connected ? <Wifi size={18} style={{ color: 'var(--accent-emerald)' }} /> : <WifiOff size={18} style={{ color: 'var(--accent-rose)' }} />}
            Connection Settings
          </h3>
          <form onSubmit={handleConnect}>
            <div className="form-grid">
              <div className="input-group">
                <label>PC IP Address</label>
                <input className="input" value={formIp} onChange={e => setFormIp(e.target.value)} placeholder="192.168.1.100" />
              </div>
              <div className="input-group">
                <label>Port</label>
                <input className="input" type="number" value={formPort} onChange={e => setFormPort(e.target.value)} placeholder="5000" />
              </div>
              <div className="input-group">
                <label>Secret Key</label>
                <input className="input" type="password" value={formKey} onChange={e => setFormKey(e.target.value)} placeholder="Secret key" />
              </div>
              <div className="input-group" style={{ justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary" disabled={pinging}>
                  {pinging ? <><div className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> Connecting...</> : <><Wifi size={16} /> Connect</>}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Status Card */}
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
              <span className="rc-status-value" style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{settings.ip ? `${settings.ip}:${settings.port}` : '—'}</span>
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

      {/* Quick Actions Grid */}
      {connected && (
        <>
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
                    {actionLoading === action.id ? <div className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} /> : <Icon size={20} />}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-tertiary)' }}>Capture a screenshot from the remote PC</span>
              <button className="btn btn-primary btn-sm" onClick={handleCaptureScreen} disabled={loadingScreen}>
                {loadingScreen ? <><div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Capturing...</> : <><Camera size={14} /> Capture</>}
              </button>
            </div>
            {screenImg ? (
              <div className="rc-screen-preview">
                <img src={screenImg} alt="Remote Screen" />
              </div>
            ) : (
              <div className="rc-screen-empty">
                <Monitor size={48} style={{ opacity: 0.3 }} />
                <p>Click "Capture" to preview the remote desktop</p>
              </div>
            )}
          </div>
        </>
      )}

      {!connected && settings.ip && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <WifiOff size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>Unable to Connect</h3>
          <p style={{ color: 'var(--text-tertiary)', maxWidth: 400, margin: '0 auto' }}>
            Make sure the IT Connect Agent is running on the target PC and the IP address is correct.
          </p>
        </div>
      )}

      {!settings.ip && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Monitor size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
          <h3 style={{ marginBottom: 8 }}>No PC Configured</h3>
          <p style={{ color: 'var(--text-tertiary)', maxWidth: 400, margin: '0 auto' }}>
            Enter the IP address and port of the PC running IT Connect Agent above to get started.
          </p>
        </div>
      )}
    </div>
  );
}
