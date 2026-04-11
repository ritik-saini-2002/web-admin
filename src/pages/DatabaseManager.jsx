import { useState, useEffect } from 'react';
import { Database, RefreshCw, ChevronRight, Eye, Table2, Search, Code2 } from 'lucide-react';
import { listCollections, listRecords } from '../api/pocketbase';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../utils/helpers';

export default function DatabaseManagerPage() {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCol, setSelectedCol] = useState(null);
  const [records, setRecords] = useState([]);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordPage, setRecordPage] = useState(1);
  const [recordTotal, setRecordTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('table'); // table | json
  const { addToast } = useToast();

  useEffect(() => { loadCollections(); }, []);

  async function loadCollections() {
    setLoading(true);
    try {
      const res = await listCollections();
      const cols = (res.items || res || []).filter(c => c.name && !c.name.startsWith('_'));
      // get record counts
      const withCounts = await Promise.all(cols.map(async (col) => {
        try {
          const r = await listRecords(col.name, { perPage: 1 });
          return { ...col, recordCount: r.totalItems || 0 };
        } catch {
          return { ...col, recordCount: '?' };
        }
      }));
      setCollections(withCounts);
    } catch (e) {
      addToast('Failed to load collections: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function selectCollection(col) {
    setSelectedCol(col);
    setRecordPage(1);
    setSearch('');
    await loadRecords(col.name, 1);
  }

  async function loadRecords(colName, page = 1) {
    setRecordsLoading(true);
    try {
      const res = await listRecords(colName, { page, perPage: 15 });
      setRecords(res.items || []);
      setRecordTotal(res.totalItems || 0);
      setRecordPage(page);
    } catch (e) {
      addToast('Failed to load records: ' + e.message, 'error');
    } finally {
      setRecordsLoading(false);
    }
  }

  if (loading) {
    return <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading collections...</span></div>;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Database Manager</h1>
          <p>Browse PocketBase collections and records</p>
        </div>
        <button className="btn btn-outline" onClick={loadCollections}><RefreshCw size={16} /> Refresh</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, minHeight: 500 }}>
        {/* Collections list */}
        <div className="card" style={{ padding: 0, alignSelf: 'flex-start', maxHeight: '80vh', overflowY: 'auto' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={16} /> Collections ({collections.length})
            </h3>
          </div>
          <div style={{ padding: 6 }}>
            {collections.map(col => (
              <div
                key={col.id}
                className={`nav-item ${selectedCol?.name === col.name ? 'active' : ''}`}
                onClick={() => selectCollection(col)}
              >
                <span className="nav-item-icon"><Table2 size={16} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-tertiary)' }}>
                    {col.type} • {col.recordCount} records
                  </div>
                </div>
                <ChevronRight size={14} style={{ opacity: 0.3, flexShrink: 0 }} />
              </div>
            ))}
          </div>
        </div>

        {/* Records panel */}
        <div className="card" style={{ padding: 0 }}>
          {!selectedCol ? (
            <div className="empty-state">
              <Database size={48} />
              <h3>Select a Collection</h3>
              <p>Choose a collection from the sidebar to browse its records and schema.</p>
            </div>
          ) : (
            <>
              {/* Collection header */}
              <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>{selectedCol.name}</h3>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                    Type: {selectedCol.type} • {recordTotal} records
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div className="tabs" style={{ marginBottom: 0 }}>
                    <button className={`tab ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>
                      <Table2 size={14} />
                    </button>
                    <button className={`tab ${viewMode === 'json' ? 'active' : ''}`} onClick={() => setViewMode('json')}>
                      <Code2 size={14} />
                    </button>
                  </div>
                  <button className="btn btn-outline btn-sm" onClick={() => loadRecords(selectedCol.name, recordPage)}>
                    <RefreshCw size={14} />
                  </button>
                </div>
              </div>

              {/* Schema section */}
              {selectedCol.fields && (
                <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>Schema Fields</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {(selectedCol.fields || []).map((f, i) => (
                      <span key={i} className="badge badge-cyan" style={{ fontSize: '0.7rem' }}>
                        {f.name} <span style={{ opacity: 0.6 }}>({f.type})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Records content */}
              {recordsLoading ? (
                <div className="loading-overlay"><div className="spinner" /><span>Loading records...</span></div>
              ) : records.length === 0 ? (
                <div className="empty-state"><h3>No records</h3><p>This collection is empty.</p></div>
              ) : viewMode === 'json' ? (
                <div style={{ padding: 16 }}>
                  <div className="json-viewer">
                    {JSON.stringify(records, null, 2)}
                  </div>
                </div>
              ) : (
                <>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>ID</th>
                          {getFieldNames(records[0]).map(f => <th key={f}>{f}</th>)}
                          <th>Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map(rec => (
                          <tr key={rec.id}>
                            <td><code style={{ fontSize: '0.72rem', color: 'var(--accent-blue)' }}>{rec.id}</code></td>
                            {getFieldNames(records[0]).map(f => (
                              <td key={f} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {renderValue(rec[f])}
                              </td>
                            ))}
                            <td style={{ fontSize: '0.75rem' }}>{formatDate(rec.created)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-pagination">
                    <span className="table-pagination-info">{recordTotal} records total</span>
                    <div className="table-pagination-btns">
                      <button className="btn btn-outline btn-sm" disabled={recordPage <= 1} onClick={() => loadRecords(selectedCol.name, recordPage - 1)}>Prev</button>
                      <span style={{ padding: '6px 12px', fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Page {recordPage}</span>
                      <button className="btn btn-outline btn-sm" disabled={records.length < 15} onClick={() => loadRecords(selectedCol.name, recordPage + 1)}>Next</button>
                    </div>
                  </div>
                </>
              )}

              {/* API Rules */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-deep)' }}>
                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 8 }}>API Rules</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6, fontSize: '0.72rem' }}>
                  {['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].map(rule => (
                    <div key={rule} style={{ padding: '6px 10px', background: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      <div style={{ color: 'var(--text-tertiary)', marginBottom: 2 }}>{rule}</div>
                      <div style={{ color: selectedCol[rule] === null ? 'var(--accent-rose)' : selectedCol[rule] === '' ? 'var(--accent-emerald)' : 'var(--accent-amber)', fontFamily: 'monospace', fontSize: '0.68rem' }}>
                        {selectedCol[rule] === null ? 'null (admin only)' : selectedCol[rule] === '' ? 'open' : selectedCol[rule] || 'null'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getFieldNames(record) {
  if (!record) return [];
  return Object.keys(record).filter(k => !['id', 'collectionId', 'collectionName', 'created', 'updated', 'expand'].includes(k)).slice(0, 8);
}

function renderValue(val) {
  if (val === null || val === undefined) return <span style={{ color: 'var(--text-tertiary)' }}>null</span>;
  if (typeof val === 'boolean') return <span className={`badge ${val ? 'badge-emerald' : 'badge-rose'}`}>{val.toString()}</span>;
  if (typeof val === 'object') return <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>{JSON.stringify(val).slice(0, 60)}</span>;
  const str = String(val);
  if (str.length > 50) return str.slice(0, 50) + '…';
  return str;
}
