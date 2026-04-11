import { useState, useEffect } from 'react';
import { RefreshCw, Trash2, RotateCw, Clock, AlertTriangle, CheckCircle } from 'lucide-react';
import { listRecords, deleteRecord, updateRecord } from '../api/pocketbase';
import { formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';

const SYNC_COLLECTION = 'sync_queue'; // may not exist, handle gracefully

export default function SyncQueuePage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const { addToast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await listRecords(SYNC_COLLECTION, { perPage: 100, sort: 'created' });
      setItems(res.items || []);
      setAvailable(true);
    } catch (e) {
      // Sync queue might not exist as a PB collection (it's a local Room table)
      setAvailable(false);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    try {
      await deleteRecord(SYNC_COLLECTION, id);
      addToast('Item removed from queue', 'success');
      load();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  async function handleClearAll() {
    if (!confirm('Clear all items from the sync queue?')) return;
    try {
      for (const item of items) {
        await deleteRecord(SYNC_COLLECTION, item.id);
      }
      addToast('Queue cleared', 'success');
      load();
    } catch (e) {
      addToast(e.message, 'error');
    }
  }

  if (loading) {
    return <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading sync queue...</span></div>;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Sync Queue</h1>
          <p>
            {available
              ? `${items.length} pending operations`
              : 'Sync queue is a local Room database table on each Android device'
            }
          </p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-outline" onClick={load}><RefreshCw size={16} /> Refresh</button>
          {items.length > 0 && (
            <button className="btn btn-danger" onClick={handleClearAll}><Trash2 size={16} /> Clear All</button>
          )}
        </div>
      </div>

      {!available ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div className="stat-icon amber" style={{ width: 56, height: 56, margin: '0 auto 16px' }}>
            <AlertTriangle size={28} />
          </div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 8 }}>Sync Queue is Local-Only</h3>
          <p style={{ color: 'var(--text-tertiary)', maxWidth: 500, margin: '0 auto', lineHeight: 1.7 }}>
            The sync queue (<code>sync_queue</code> table) exists as a <strong>Room local database</strong> on each Android device.
            It stores offline operations (CREATE, UPDATE, DELETE) that need to be synced to PocketBase when connectivity is restored.
          </p>
          <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, maxWidth: 600, margin: '24px auto 0' }}>
            <div style={{ padding: 16, background: 'var(--bg-deep)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 4 }}>Operation Types</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {['CREATE', 'UPDATE', 'DELETE', 'ROLE_CHANGE', 'MOVE_USER'].map(t => (
                  <span key={t} className="badge badge-blue">{t}</span>
                ))}
              </div>
            </div>
            <div style={{ padding: 16, background: 'var(--bg-deep)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: 4 }}>Queue Fields</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {['collection', 'recordId', 'payload', 'retryCount', 'lastError'].map(f => (
                  <span key={f} className="badge badge-emerald">{f}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <div className="stat-icon emerald" style={{ width: 56, height: 56, margin: '0 auto 16px' }}>
            <CheckCircle size={28} />
          </div>
          <h3 style={{ fontSize: '1.1rem', marginBottom: 8 }}>All Synced!</h3>
          <p style={{ color: 'var(--text-tertiary)' }}>No pending operations in the sync queue.</p>
        </div>
      ) : (
        <div className="table-container">
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Operation</th>
                  <th>Collection</th>
                  <th>Record ID</th>
                  <th>Created</th>
                  <th>Retries</th>
                  <th>Last Error</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td><code style={{ fontSize: '0.72rem' }}>{item.id}</code></td>
                    <td><span className="badge badge-amber">{item.operationType || item.operation || '—'}</span></td>
                    <td>{item.collection || '—'}</td>
                    <td><code style={{ fontSize: '0.72rem' }}>{item.recordId || '—'}</code></td>
                    <td>{formatDate(item.created || item.createdAt)}</td>
                    <td>{item.retryCount || 0}</td>
                    <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--accent-rose)', fontSize: '0.78rem' }}>{item.lastError || '—'}</td>
                    <td>
                      <button className="btn btn-ghost btn-icon btn-sm" title="Remove" onClick={() => handleDelete(item.id)}>
                        <Trash2 size={15} style={{ color: 'var(--accent-rose)' }} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
