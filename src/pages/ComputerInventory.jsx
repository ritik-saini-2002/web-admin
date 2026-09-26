import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Laptop, Search, RefreshCw, FileSpreadsheet, FileText, Printer,
  Eye, ChevronUp, ChevronDown, HardDrive, MonitorSmartphone,
} from 'lucide-react';
import { listRecords, COL_COMPUTER_INVENTORY } from '../api/pocketbase';
import { formatDate } from '../utils/helpers';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';

// Same department list the collector script (CollectComputerData.ps1) offers
// on the PC side, so the filter dropdown here always matches what people
// actually picked when submitting an entry.
const DEPARTMENTS = [
  'Faculty', 'Accounts', 'PA', 'Establishment', 'Protocol', 'Computer Section',
  'Estate', 'CoE', 'S & S', 'Trg1', 'Trg4', 'TRPC',
];

// Column order/labels shared by the on-screen "view" modal and every export
// (Excel / PDF / Print) so they never drift apart.
const EXPORT_COLUMNS = [
  { label: 'User Name', value: r => r.user_name },
  { label: 'Department', value: r => r.department },
  { label: 'Computer Name', value: r => r.computer_name },
  { label: 'Windows Login', value: r => r.windows_username },
  { label: 'Device Type', value: r => r.device_type },
  { label: 'OS', value: r => r.os_name },
  { label: 'System Model', value: r => r.system_model },
  { label: 'CPU', value: r => r.cpu },
  { label: 'RAM (GB)', value: r => r.ram_gb },
  { label: 'Disk Total (GB)', value: r => r.disk_total_gb },
  { label: 'Disk Free (GB)', value: r => r.disk_free_gb },
  { label: 'Local User Accounts', value: r => r.local_user_accounts },
  { label: 'Last Windows Update', value: r => r.last_update },
  { label: 'MAC Address', value: r => r.mac_address },
  { label: 'IP Address', value: r => r.ip_address },
  { label: 'Connection Type', value: r => r.connection_type },
  { label: 'Printer Name', value: r => r.printer_name },
  { label: 'Printer IP', value: r => r.printer_ip },
  { label: 'Remark', value: r => r.remark },
  { label: 'Submitted On', value: r => formatDate(r.created) },
];

function dateStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default function ComputerInventoryPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [deviceFilter, setDeviceFilter] = useState('');
  const [sortField, setSortField] = useState('created');
  const [sortDir, setSortDir] = useState('desc');
  const [sortOk, setSortOk] = useState(true); // false once we learn this field can't be sorted server-side
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailRecord, setDetailRecord] = useState(null);
  const [exporting, setExporting] = useState(''); // '' | 'excel' | 'pdf' | 'print'
  const { addToast } = useToast();
  const notifiedSortFieldsRef = useRef(new Set()); // avoid repeating the same "can't sort" toast

  // Loaded lazily on first PDF export click, not on every keystroke — keeps
  // this library out of the initial bundle for everyone who never exports.
  const pdfRef  = useRef(null);      // jsPDF constructor
  const autoTableRef = useRef(null); // jspdf-autotable's autoTable(doc, opts) function

  const perPage = 20;
  const totalPages = Math.max(1, Math.ceil(total / perPage));

  const filterStr = useMemo(() => {
    const filters = [];
    if (search) {
      const s = search.replace(/'/g, "\\'");
      filters.push(`(user_name~'${s}' || computer_name~'${s}' || windows_username~'${s}' || ip_address~'${s}' || mac_address~'${s}' || remark~'${s}')`);
    }
    if (deptFilter) filters.push(`department='${deptFilter.replace(/'/g, "\\'")}'`);
    if (deviceFilter) filters.push(`device_type='${deviceFilter}'`);
    return filters.length ? filters.join(' && ') : undefined;
  }, [search, deptFilter, deviceFilter]);

  const sortStr = useMemo(() => `${sortDir === 'desc' ? '-' : ''}${sortField}`, [sortField, sortDir]);

  // Reset once the person picks a different column — a field that failed
  // to sort shouldn't permanently block sorting by every other field too.
  useEffect(() => { setSortOk(true); }, [sortField]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let res;
      try {
        res = await listRecords(COL_COMPUTER_INVENTORY, {
          page, perPage, filter: filterStr, sort: sortOk ? sortStr : undefined, noCache: true, asSuperuser: true,
        });
      } catch (err) {
        // PocketBase 400s when asked to sort by a field the collection's
        // schema doesn't actually have — most commonly "created"/"updated"
        // when those autodate fields were never added to this collection.
        // Fall back to an unsorted request rather than showing nothing.
        if (sortOk && /sort|400/i.test(err.message)) {
          setSortOk(false);
          if (!notifiedSortFieldsRef.current.has(sortField)) {
            notifiedSortFieldsRef.current.add(sortField);
            addToast(
                `Can't sort by "${sortField}" — that field doesn't seem to exist on the computer_inventory collection in PocketBase. Showing results unsorted instead.`,
                'info',
            );
          }
          res = await listRecords(COL_COMPUTER_INVENTORY, { page, perPage, filter: filterStr, noCache: true, asSuperuser: true });
        } else {
          throw err;
        }
      }
      setRecords(res.items || []);
      setTotal(res.totalItems || 0);
    } catch (e) {
      addToast('Failed to load computer inventory: ' + (e.message || 'Unknown error'), 'error');
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [page, filterStr, sortStr, sortField, sortOk, addToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, deptFilter, deviceFilter]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }
  const SortIcon = ({ field }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
  };

  // Pulls every record matching the current filters (not just the visible
  // page) so an export always reflects what the person searched/filtered
  // for. Paginates in batches of 200, capped at 5,000 records as a safety net.
  async function fetchAllMatching() {
    let all = [];
    let p = 1;
    const batch = 200;
    const sortParam = sortOk ? sortStr : undefined;
    while (p <= 25) {
      const res = await listRecords(COL_COMPUTER_INVENTORY, {
        page: p, perPage: batch, filter: filterStr, sort: sortParam, noCache: true, asSuperuser: true,
      });
      const items = res.items || [];
      all = all.concat(items);
      if (items.length < batch || all.length >= (res.totalItems || 0)) break;
      p++;
    }
    return all;
  }

  // Builds an RFC-4180-ish CSV — no library needed, and Excel opens .csv
  // natively — so the Excel export has zero extra dependencies to keep patched.
  function buildCsv(rows) {
    const esc = v => {
      const s = String(v ?? '');
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const header = EXPORT_COLUMNS.map(c => esc(c.label)).join(',');
    const body = rows.map(r => EXPORT_COLUMNS.map(c => esc(c.value(r))).join(',')).join('\r\n');
    return header + '\r\n' + body;
  }

  async function handleExportExcel() {
    if (exporting) return;
    setExporting('excel');
    try {
      const all = await fetchAllMatching();
      if (all.length === 0) { addToast('No records to export', 'info'); return; }
      // Leading BOM so Excel (Windows) detects UTF-8 correctly instead of
      // mangling non-ASCII characters.
      const blob = new Blob(['\uFEFF' + buildCsv(all)], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `computer_inventory_${dateStamp()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      addToast(`Exported ${all.length} record${all.length === 1 ? '' : 's'} to CSV (opens in Excel)`, 'success');
    } catch (e) {
      addToast('Excel export failed: ' + e.message, 'error');
    } finally {
      setExporting('');
    }
  }

  async function handleExportPdf() {
    if (exporting) return;
    setExporting('pdf');
    try {
      if (!pdfRef.current) {
        const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
          import('jspdf'),
          import('jspdf-autotable'),
        ]);
        pdfRef.current = jsPDF;
        autoTableRef.current = autoTable;
      }
      const jsPDF = pdfRef.current;
      const autoTable = autoTableRef.current;
      const all = await fetchAllMatching();
      if (all.length === 0) { addToast('No records to export', 'info'); return; }

      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      doc.setFontSize(14);
      doc.text('Computer Inventory Report', 40, 32);
      doc.setFontSize(9);
      doc.setTextColor(100);
      doc.text(`Generated ${new Date().toLocaleString('en-IN')}  •  ${all.length} record${all.length === 1 ? '' : 's'}`, 40, 48);

      autoTable(doc, {
        head: [EXPORT_COLUMNS.map(c => c.label)],
        body: all.map(r => EXPORT_COLUMNS.map(c => String(c.value(r) ?? ''))),
        startY: 60,
        styles: { fontSize: 6.5, cellPadding: 3, overflow: 'linebreak' },
        headStyles: { fillColor: [37, 99, 235], textColor: 255 },
        margin: { left: 20, right: 20 },
      });

      doc.save(`computer_inventory_${dateStamp()}.pdf`);
      addToast(`Exported ${all.length} record${all.length === 1 ? '' : 's'} to PDF`, 'success');
    } catch (e) {
      addToast('PDF export failed: ' + e.message, 'error');
    } finally {
      setExporting('');
    }
  }

  async function handlePrint() {
    if (exporting) return;
    setExporting('print');
    try {
      const all = await fetchAllMatching();
      if (all.length === 0) { addToast('No records to print', 'info'); return; }

      const headers = EXPORT_COLUMNS.map(c => `<th>${escapeHtml(c.label)}</th>`).join('');
      const rows = all.map(r => `<tr>${EXPORT_COLUMNS.map(c => `<td>${escapeHtml(c.value(r))}</td>`).join('')}</tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Computer Inventory</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 4px}
  p{font-size:11px;color:#555;margin:0 0 16px}
  table{border-collapse:collapse;width:100%;font-size:8.5px}
  th,td{border:1px solid #999;padding:4px 6px;text-align:left;white-space:nowrap}
  th{background:#eee}
  @media print { @page { size: A4 landscape; margin: 12mm; } }
</style></head>
<body>
  <h1>Computer Inventory Report</h1>
  <p>Generated ${new Date().toLocaleString('en-IN')} &bull; ${all.length} record${all.length === 1 ? '' : 's'}</p>
  <table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
  <script>window.onload = function(){ window.print(); };</script>
</body></html>`;

      const w = window.open('', '_blank');
      if (!w) { addToast('Please allow pop-ups for this site to print', 'error'); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      addToast('Print failed: ' + e.message, 'error');
    } finally {
      setExporting('');
    }
  }

  return (
    <div className="animate-in">
      <div className="page-header">
        <div>
          <h1>Computer Inventory</h1>
          <p>{total} entr{total === 1 ? 'y' : 'ies'} submitted from CollectComputerData.ps1</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-outline" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button className="btn btn-outline" onClick={handleExportExcel} disabled={!!exporting} title="Downloads a CSV file that opens directly in Excel">
            <FileSpreadsheet size={16} /> {exporting === 'excel' ? 'Exporting…' : 'Excel'}
          </button>
          <button className="btn btn-outline" onClick={handleExportPdf} disabled={!!exporting}>
            <FileText size={16} /> {exporting === 'pdf' ? 'Exporting…' : 'PDF'}
          </button>
          <button className="btn btn-primary" onClick={handlePrint} disabled={!!exporting}>
            <Printer size={16} /> {exporting === 'print' ? 'Preparing…' : 'Print'}
          </button>
        </div>
      </div>

      <div className="table-container">
        <div className="table-toolbar">
          <div className="table-toolbar-left">
            <div className="search-box" style={{ minWidth: 260 }}>
              <Search size={16} />
              <input
                placeholder="Search name, PC, IP, MAC..."
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select className="select" style={{ width: 180 }} value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
              <option value="">All Departments</option>
              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="select" style={{ width: 130 }} value={deviceFilter} onChange={e => setDeviceFilter(e.target.value)}>
              <option value="">All Devices</option>
              <option value="PC">PC</option>
              <option value="Laptop">Laptop</option>
            </select>
          </div>
          <div className="table-toolbar-right">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
              Page {page} of {totalPages}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="loading-overlay"><div className="spinner spinner-lg" /><span>Loading inventory...</span></div>
        ) : records.length === 0 ? (
          <div className="empty-state">
            <Laptop size={48} />
            <h3>No entries found</h3>
            <p>Either nothing matches your filters, or no PC has submitted data yet.</p>
          </div>
        ) : (
          <>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th onClick={() => handleSort('user_name')} className={sortField === 'user_name' ? 'sorted' : ''}>User <SortIcon field="user_name" /></th>
                    <th onClick={() => handleSort('department')} className={sortField === 'department' ? 'sorted' : ''}>Department <SortIcon field="department" /></th>
                    <th onClick={() => handleSort('computer_name')} className={sortField === 'computer_name' ? 'sorted' : ''}>Computer <SortIcon field="computer_name" /></th>
                    <th>Device</th>
                    <th>OS</th>
                    <th>CPU</th>
                    <th>RAM</th>
                    <th>Disk Free/Total</th>
                    <th>IP Address</th>
                    <th>Printer</th>
                    <th onClick={() => handleSort('created')} className={sortField === 'created' ? 'sorted' : ''}>Submitted <SortIcon field="created" /></th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map(r => (
                    <tr key={r.id}>
                      <td>
                        <div className="user-details">
                          <span className="user-name">{r.user_name || '—'}</span>
                          <span className="user-email">{r.windows_username || '—'}</span>
                        </div>
                      </td>
                      <td>{r.department || '—'}</td>
                      <td>{r.computer_name || '—'}</td>
                      <td><span className={`badge ${r.device_type === 'Laptop' ? 'badge-purple' : 'badge-blue'}`}>{r.device_type || '—'}</span></td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.os_name || '—'}</td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.cpu || '—'}</td>
                      <td>{r.ram_gb ? `${r.ram_gb} GB` : '—'}</td>
                      <td>{r.disk_free_gb || '—'} / {r.disk_total_gb || '—'} GB</td>
                      <td style={{ fontSize: '0.78rem' }}>{r.ip_address || '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{r.printer_name || '—'}</td>
                      <td style={{ fontSize: '0.78rem' }}>{formatDate(r.created)}</td>
                      <td>
                        <button className="btn btn-ghost btn-icon btn-sm" title="View full details" onClick={() => setDetailRecord(r)}>
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-pagination">
              <span className="table-pagination-info">
                Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
              </span>
              <div className="table-pagination-btns">
                <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
                <button className="btn btn-outline btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {detailRecord && <DetailModal record={detailRecord} onClose={() => setDetailRecord(null)} />}
    </div>
  );
}

function DetailModal({ record: r, onClose }) {
  return (
    <Modal open title={r.computer_name || 'Computer Details'} onClose={onClose} large>
      <div className="detail-grid" style={{ marginBottom: 0 }}>
        <div>
          <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>
            <MonitorSmartphone size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Person &amp; PC
          </h4>
          <div className="detail-row"><span className="detail-label">User Name</span><span className="detail-value">{r.user_name || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Windows Login</span><span className="detail-value">{r.windows_username || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Department</span><span className="detail-value">{r.department || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Computer Name</span><span className="detail-value">{r.computer_name || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Device Type</span><span className={`badge ${r.device_type === 'Laptop' ? 'badge-purple' : 'badge-blue'}`}>{r.device_type || '—'}</span></div>
        </div>
        <div>
          <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>
            <HardDrive size={13} style={{ marginRight: 4, verticalAlign: -2 }} />Hardware
          </h4>
          <div className="detail-row"><span className="detail-label">OS</span><span className="detail-value">{r.os_name || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">System Model</span><span className="detail-value">{r.system_model || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">CPU</span><span className="detail-value">{r.cpu || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">RAM</span><span className="detail-value">{r.ram_gb ? `${r.ram_gb} GB` : '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Disk (Free / Total)</span><span className="detail-value">{r.disk_free_gb || '—'} / {r.disk_total_gb || '—'} GB</span></div>
          <div className="detail-row"><span className="detail-label">Local User Accounts</span><span className="detail-value" style={{ fontSize: '0.78rem' }}>{r.local_user_accounts || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Last Windows Update</span><span className="detail-value">{r.last_update || '—'}</span></div>
        </div>
        <div>
          <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>Network &amp; Printer</h4>
          <div className="detail-row"><span className="detail-label">MAC Address</span><span className="detail-value">{r.mac_address || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">IP Address</span><span className="detail-value">{r.ip_address || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Connection Type</span><span className="detail-value">{r.connection_type || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Printer Name</span><span className="detail-value">{r.printer_name || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Printer IP</span><span className="detail-value">{r.printer_ip || '—'}</span></div>
        </div>
        <div>
          <h4 style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: 8, textTransform: 'uppercase' }}>Other</h4>
          <div className="detail-row"><span className="detail-label">Remark</span><span className="detail-value">{r.remark || '—'}</span></div>
          <div className="detail-row"><span className="detail-label">Submitted On</span><span className="detail-value">{formatDate(r.created)}</span></div>
          <div className="detail-row"><span className="detail-label">Record ID</span><span className="detail-value" style={{ fontSize: '0.72rem' }}>{r.id}</span></div>
        </div>
      </div>
    </Modal>
  );
}