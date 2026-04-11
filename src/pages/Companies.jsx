import { useState, useEffect } from 'react';
import { Building2, Users, RefreshCw, FolderTree, ShieldCheck } from 'lucide-react';
import { listRecords, COL_COMPANIES } from '../api/pocketbase';
import { useToast } from '../context/ToastContext';
import { parseJsonSafe } from '../utils/helpers';

export default function CompaniesPage() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const { addToast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const res = await listRecords(COL_COMPANIES, { perPage: 200 });
      setCompanies(res.items || []);
    } catch (e) {
      addToast('Failed to load companies: ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading companies...</span></div>;
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Company Management</h1>
          <p>{companies.length} registered companies</p>
        </div>
        <button className="btn btn-outline" onClick={load}><RefreshCw size={16} /> Refresh</button>
      </div>

      {companies.length === 0 ? (
        <div className="empty-state">
          <Building2 size={48} />
          <h3>No companies found</h3>
          <p>Companies are auto-created when users register.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 20 }}>
          {companies.map(company => {
            const roles = parseJsonSafe(company.availableRoles) || [];
            const depts = parseJsonSafe(company.departments) || [];
            return (
              <div className="card" key={company.id}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 20 }}>
                  <div className="stat-icon amber" style={{ width: 50, height: 50 }}>
                    <Building2 size={24} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{company.originalName || company.sanitizedName}</h3>
                    <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{company.sanitizedName}</p>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 24, marginBottom: 18 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>{company.totalUsers || 0}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><Users size={11} /> Total</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent-emerald)' }}>{company.activeUsers || 0}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>Active</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent-purple)' }}>{Array.isArray(roles) ? roles.length : 0}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><ShieldCheck size={11} /> Roles</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent-amber)' }}>{Array.isArray(depts) ? depts.length : 0}</div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}><FolderTree size={11} /> Depts</div>
                  </div>
                </div>

                {Array.isArray(depts) && depts.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Departments</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {depts.map((d, i) => <span key={i} className="badge badge-emerald">{d}</span>)}
                    </div>
                  </div>
                )}

                {Array.isArray(roles) && roles.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Roles</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {roles.map((r, i) => <span key={i} className="badge badge-purple">{r}</span>)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
