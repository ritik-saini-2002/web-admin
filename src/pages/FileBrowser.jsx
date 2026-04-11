import { useState, useCallback, useEffect } from 'react';
import {
  HardDrive, Folder, FolderOpen, File, ArrowLeft, Home, RefreshCw,
  Search, Upload, Download, Trash2, FolderPlus, ChevronRight,
  Filter, Grid, List, Star, Clock
} from 'lucide-react';
import { usePcControl } from '../context/PcControlContext';
import {
  getDrives, browseDir, searchFiles, getSpecialFolders, getRecentPaths,
  getDownloadUrl, uploadFile, executeQuickStep,
  getFileIcon, formatFileSize
} from '../api/pcControlApi';
import { useToast } from '../context/ToastContext';

const FILE_FILTERS = [
  { id: 'all', label: 'All', exts: '' },
  { id: 'media', label: 'Media', exts: 'mp4,mkv,avi,mp3,wav,flac,mov' },
  { id: 'docs', label: 'Docs', exts: 'pdf,docx,doc,pptx,ppt,xlsx,txt' },
  { id: 'images', label: 'Images', exts: 'jpg,jpeg,png,gif,bmp,webp' },
  { id: 'scripts', label: 'Scripts', exts: 'py,bat,ps1,sh,cmd' },
];

export default function FileBrowserPage() {
  const { settings, baseUrl, connected, pcName } = usePcControl();
  const { addToast } = useToast();

  const [drives, setDrives] = useState([]);
  const [files, setFiles] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [pathHistory, setPathHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('all');
  const [viewMode, setViewMode] = useState('list'); // list | grid
  const [specialFolders, setSpecialFolders] = useState([]);
  const [recentPaths, setRecentPaths] = useState([]);
  const [showSidebar, setShowSidebar] = useState(true);
  const [sortBy, setSortBy] = useState('name'); // name | size | date
  const [sortDir, setSortDir] = useState('asc');

  // ── Load drives on mount ──
  useEffect(() => {
    if (connected) {
      loadDrives();
      loadSpecialFolders();
      loadRecentPaths();
    }
  }, [connected]);

  async function loadDrives() {
    setLoading(true);
    try {
      const res = await getDrives(baseUrl, settings.secretKey);
      if (res.ok && Array.isArray(res.data)) {
        setDrives(res.data);
      }
    } catch (e) {
      addToast('Failed to load drives: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadSpecialFolders() {
    try {
      const res = await getSpecialFolders(baseUrl, settings.secretKey);
      if (res.ok && Array.isArray(res.data)) setSpecialFolders(res.data);
    } catch {}
  }

  async function loadRecentPaths() {
    try {
      const res = await getRecentPaths(baseUrl, settings.secretKey);
      if (res.ok && Array.isArray(res.data)) setRecentPaths(res.data);
    } catch {}
  }

  async function navigateTo(path) {
    setLoading(true);
    setSearchQuery('');
    setSearching(false);
    try {
      const filterObj = FILE_FILTERS.find(f => f.id === filter);
      const res = await browseDir(baseUrl, settings.secretKey, path, filterObj?.exts || '');
      if (res.ok && Array.isArray(res.data)) {
        if (currentPath) {
          setPathHistory(prev => [...prev, currentPath]);
        }
        setFiles(sortFiles(res.data));
        setCurrentPath(path);
      } else {
        addToast('Failed to browse: ' + (res.error || 'Unknown error'), 'error');
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    if (pathHistory.length > 0) {
      const prev = pathHistory[pathHistory.length - 1];
      setPathHistory(h => h.slice(0, -1));
      loadPath(prev);
    } else {
      setCurrentPath('');
      setFiles([]);
    }
  }

  async function loadPath(path) {
    setLoading(true);
    try {
      const filterObj = FILE_FILTERS.find(f => f.id === filter);
      const res = await browseDir(baseUrl, settings.secretKey, path, filterObj?.exts || '');
      if (res.ok && Array.isArray(res.data)) {
        setFiles(sortFiles(res.data));
        setCurrentPath(path);
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim() || !currentPath) return;
    setSearching(true);
    setLoading(true);
    try {
      const res = await searchFiles(baseUrl, settings.secretKey, currentPath, searchQuery);
      if (res.ok && Array.isArray(res.data)) {
        setFiles(sortFiles(res.data));
      }
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function handleFileClick(file) {
    if (file.isDir) {
      navigateTo(file.path);
    } else {
      // Open file on PC
      executeQuickStep(baseUrl, settings.secretKey, { type: 'OPEN_FILE', value: file.path });
      addToast(`Opening ${file.name} on PC...`, 'info');
    }
  }

  function handleDownload(file) {
    const url = getDownloadUrl(baseUrl, settings.secretKey, file.path);
    // Open download in new tab with auth header — simplified since we can't set headers on <a> download
    // We'll use fetch + blob approach
    downloadViaFetch(file);
  }

  async function downloadViaFetch(file) {
    addToast(`Downloading ${file.name}...`, 'info');
    try {
      const res = await fetch(getDownloadUrl(baseUrl, settings.secretKey, file.path), {
        headers: {
          'X-Secret-Key': settings.secretKey,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = file.name;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast(`Downloaded ${file.name}`, 'success');
    } catch (e) {
      addToast('Download failed: ' + e.message, 'error');
    }
  }

  async function handleUpload() {
    if (!currentPath) { addToast('Navigate to a folder first', 'error'); return; }
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = async (e) => {
      const uploadedFiles = e.target.files;
      for (const file of uploadedFiles) {
        addToast(`Uploading ${file.name}...`, 'info');
        try {
          const res = await uploadFile(baseUrl, settings.secretKey, file, currentPath);
          if (res.ok) addToast(`Uploaded ${file.name}`, 'success');
          else addToast(`Upload failed: ${file.name}`, 'error');
        } catch (err) {
          addToast(`Upload error: ${err.message}`, 'error');
        }
      }
      // Reload current directory
      loadPath(currentPath);
    };
    input.click();
  }

  async function handleCreateFolder() {
    if (!currentPath) return;
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      await executeQuickStep(baseUrl, settings.secretKey, {
        type: 'SYSTEM_CMD',
        action: 'MKDIR',
        value: currentPath + '\\' + name,
      });
      addToast('Folder created', 'success');
      loadPath(currentPath);
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  function sortFiles(fileList) {
    const dirs = fileList.filter(f => f.isDir);
    const items = fileList.filter(f => !f.isDir);
    const sorter = (a, b) => {
      let cmp = 0;
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name);
      else if (sortBy === 'size') cmp = (a.sizeKb || 0) - (b.sizeKb || 0);
      else if (sortBy === 'date') cmp = (a.modTime || 0) - (b.modTime || 0);
      return sortDir === 'asc' ? cmp : -cmp;
    };
    dirs.sort(sorter);
    items.sort(sorter);
    return [...dirs, ...items];
  }

  // Breadcrumb
  const pathParts = currentPath ? currentPath.split('\\').filter(Boolean) : [];

  if (!connected) {
    return (
      <div className="animate-in">
        <div className="page-header"><div><h1>File Browser</h1><p>Browse remote PC file system</p></div></div>
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <Folder size={48} style={{ opacity: 0.3, marginBottom: 16 }} />
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
          <h1>File Browser</h1>
          <p>Browsing {pcName} {currentPath ? `— ${currentPath}` : ''}</p>
        </div>
        <div className="page-header-actions">
          {currentPath && (
            <>
              <button className="btn btn-outline btn-sm" onClick={handleUpload}><Upload size={14} /> Upload</button>
              <button className="btn btn-outline btn-sm" onClick={handleCreateFolder}><FolderPlus size={14} /> New Folder</button>
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={() => currentPath ? loadPath(currentPath) : loadDrives()}>
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="fb-layout">
        {/* Sidebar */}
        {showSidebar && (
          <div className="fb-sidebar">
            {/* Drives */}
            <div className="fb-sidebar-section">
              <h4><HardDrive size={14} /> Drives</h4>
              {drives.map(d => (
                <button key={d.letter} className="fb-sidebar-item" onClick={() => navigateTo(d.letter + '\\')}>
                  <HardDrive size={14} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{d.letter} {d.label && `(${d.label})`}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>{d.freeGb?.toFixed(1)} GB free / {d.totalGb?.toFixed(1)} GB</div>
                  </div>
                  <div className="fb-drive-bar">
                    <div className="fb-drive-fill" style={{ width: `${d.totalGb > 0 ? ((d.totalGb - d.freeGb) / d.totalGb * 100) : 0}%` }} />
                  </div>
                </button>
              ))}
            </div>

            {/* Special Folders */}
            {specialFolders.length > 0 && (
              <div className="fb-sidebar-section">
                <h4><Star size={14} /> Quick Access</h4>
                {specialFolders.map((sf, i) => (
                  <button key={i} className="fb-sidebar-item" onClick={() => navigateTo(sf.path || sf.Path)}>
                    <Folder size={14} />
                    <span style={{ fontSize: '0.82rem' }}>{sf.name || sf.Name || sf.label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Recent */}
            {recentPaths.length > 0 && (
              <div className="fb-sidebar-section">
                <h4><Clock size={14} /> Recent</h4>
                {recentPaths.slice(0, 6).map((rp, i) => (
                  <button key={i} className="fb-sidebar-item" onClick={() => navigateTo(rp.path)}>
                    <span style={{ fontSize: '0.9rem' }}>{rp.icon || '📁'}</span>
                    <span style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rp.label || rp.path}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Main content */}
        <div className="fb-main">
          {/* Toolbar */}
          <div className="fb-toolbar">
            <div className="fb-toolbar-left">
              <button className="btn btn-ghost btn-icon btn-sm" onClick={goBack} disabled={!currentPath}>
                <ArrowLeft size={16} />
              </button>
              <button className="btn btn-ghost btn-icon btn-sm" onClick={() => { setCurrentPath(''); setFiles([]); setPathHistory([]); }}>
                <Home size={16} />
              </button>

              {/* Breadcrumb */}
              <div className="fb-breadcrumb">
                <button onClick={() => { setCurrentPath(''); setFiles([]); setPathHistory([]); }} className="fb-crumb">
                  <HardDrive size={12} /> Root
                </button>
                {pathParts.map((part, i) => {
                  const path = pathParts.slice(0, i + 1).join('\\');
                  return (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ChevronRight size={12} style={{ opacity: 0.3 }} />
                      <button onClick={() => navigateTo(path + '\\')} className="fb-crumb">{part}</button>
                    </span>
                  );
                })}
              </div>
            </div>

            <div className="fb-toolbar-right">
              {currentPath && (
                <div className="search-box" style={{ minWidth: 180 }}>
                  <Search size={14} />
                  <input
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                  />
                </div>
              )}
              <div className="tabs" style={{ marginBottom: 0 }}>
                {FILE_FILTERS.map(f => (
                  <button key={f.id} className={`tab ${filter === f.id ? 'active' : ''}`} onClick={() => { setFilter(f.id); if (currentPath) loadPath(currentPath); }} style={{ fontSize: '0.72rem', padding: '4px 8px' }}>
                    {f.label}
                  </button>
                ))}
              </div>
              <div className="tabs" style={{ marginBottom: 0 }}>
                <button className={`tab ${viewMode === 'list' ? 'active' : ''}`} onClick={() => setViewMode('list')}><List size={14} /></button>
                <button className={`tab ${viewMode === 'grid' ? 'active' : ''}`} onClick={() => setViewMode('grid')}><Grid size={14} /></button>
              </div>
            </div>
          </div>

          {/* Content */}
          {loading ? (
            <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading...</span></div>
          ) : !currentPath ? (
            /* Drive cards */
            <div className="fb-drives-grid">
              {drives.map(d => (
                <div key={d.letter} className="fb-drive-card" onClick={() => navigateTo(d.letter + '\\')}>
                  <div className="fb-drive-card-icon"><HardDrive size={28} /></div>
                  <div className="fb-drive-card-info">
                    <div className="fb-drive-card-label">{d.letter} Drive {d.label && `(${d.label})`}</div>
                    <div className="fb-drive-card-space">{d.freeGb?.toFixed(1)} GB free of {d.totalGb?.toFixed(1)} GB</div>
                    <div className="fb-drive-bar large">
                      <div className="fb-drive-fill" style={{ width: `${d.totalGb > 0 ? ((d.totalGb - d.freeGb) / d.totalGb * 100) : 0}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : files.length === 0 ? (
            <div className="empty-state">
              <Folder size={48} />
              <h3>{searching ? 'No results found' : 'Empty folder'}</h3>
              <p>{searching ? 'Try a different search term' : 'This folder has no files'}</p>
            </div>
          ) : viewMode === 'grid' ? (
            <div className="fb-file-grid">
              {files.map((file, i) => (
                <div key={i} className="fb-file-grid-item" onClick={() => handleFileClick(file)}>
                  <div className="fb-file-grid-icon">
                    {file.isDir ? <Folder size={32} style={{ color: 'var(--accent-amber)' }} /> :
                     <span style={{ fontSize: '1.8rem' }}>{getFileIcon(file.extension)}</span>}
                  </div>
                  <div className="fb-file-grid-name">{file.name}</div>
                  {!file.isDir && <div className="fb-file-grid-size">{formatFileSize(file.sizeKb)}</div>}
                  {!file.isDir && (
                    <button className="fb-file-dl-btn" title="Download" onClick={(e) => { e.stopPropagation(); handleDownload(file); }}>
                      <Download size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => { setSortBy('name'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>Name</th>
                    <th onClick={() => { setSortBy('size'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }} style={{ width: 100 }}>Size</th>
                    <th style={{ width: 80 }}>Type</th>
                    <th style={{ width: 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file, i) => (
                    <tr key={i} onClick={() => handleFileClick(file)} style={{ cursor: 'pointer' }}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {file.isDir ?
                            <FolderOpen size={16} style={{ color: 'var(--accent-amber)', flexShrink: 0 }} /> :
                            <span style={{ fontSize: '1rem', flexShrink: 0 }}>{getFileIcon(file.extension)}</span>
                          }
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>
                        </div>
                      </td>
                      <td>{file.isDir ? '—' : formatFileSize(file.sizeKb)}</td>
                      <td><span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{file.isDir ? 'Folder' : (file.extension || '—').toUpperCase()}</span></td>
                      <td>
                        {!file.isDir && (
                          <button className="btn btn-ghost btn-icon btn-sm" title="Download" onClick={(e) => { e.stopPropagation(); handleDownload(file); }}>
                            <Download size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
