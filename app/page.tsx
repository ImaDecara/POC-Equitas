'use client';

import { useEffect, useState } from 'react';

const entities = ['Client', 'ElementType', 'Element', 'ClientElementConfig', 'LogStatus', 'Log'];
const cases = ['Happy Path', 'Failure Without Fallback', 'Fallback Recovery', 'Session Retry Limit', 'Accumulated Errors'];

type Row = Record<string, unknown>;
type LogNode = { id: string; element: string; status: string; details?: string; startedAt: string; children: LogNode[] };

/** Keep API values readable without rendering raw JSON objects in table cells. */
function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') {
    if (Array.isArray(value)) return value.map(display).join(', ');
    const r = value as Row;
    return String(r.Code ?? r.Name ?? r.code ?? r.name ?? r.Id ?? r.id ?? '—');
  }
  return String(value);
}

function asCode(value: unknown): string {
  return display(value) === '—' ? '' : display(value);
}

function isElementType(row: Row, type: string): boolean {
  return asCode(row.Type ?? row.type).toUpperCase() === type;
}

/** Group each integration immediately after its service, then its ordered steps. */
function orderElements(records: Row[]): Row[] {
  const indexed = records.map((row, index) => ({ row, index }));
  const name = (r: Row) => asCode(r.Code ?? r.Name ?? r.code ?? r.name);
  const order = (r: Row) => Number(r.Order ?? r.ExecutionOrder ?? r.executionOrder ?? 9999);
  const byOrder = (a: {row:Row;index:number}, b:{row:Row;index:number}) =>
    order(a.row) - order(b.row) || a.index - b.index;
  const roots = indexed.filter(x => isElementType(x.row, 'SERVICE')).sort(byOrder);
  const seen = new Set<number>();
  const output: Row[] = [];
  const add = (item: {row: Row; index: number}) => {
    if (seen.has(item.index)) return;
    seen.add(item.index);
    output.push(item.row);
    const parentName = name(item.row);
    indexed.filter(x => asCode(x.row.Parent ?? x.row.parent) === parentName)
      .sort(byOrder).forEach(add);
  };
  roots.forEach(add);
  // Keep records visible even when the API returns an incomplete parent relation.
  indexed.filter(x => !seen.has(x.index)).sort(byOrder).forEach(add);
  return output;
}

const elementColumns = ['Name', 'Code', 'Type', 'Parent', 'Order', 'Fallback'];

function LogBranch({ node, level = 0 }: { node: LogNode; level?: number }) {
  return <div style={{ marginLeft: level ? 20 : 0, borderLeft: level ? '1px solid #233348' : undefined, paddingLeft: level ? 12 : 0, marginTop: 8 }}>
    <div className="log"><b>{node.element}</b><span className={node.status === 'SUCCESS' ? 'ok' : node.status === 'FAILED' ? 'bad' : ''}>{node.status}</span><small>{node.startedAt}</small><p>{node.details}</p></div>
    {(node.children ?? []).map(n => <LogBranch key={n.id} node={n} level={level + 1} />)}
  </div>;
}

export default function Home() {
  const [token, setToken] = useState('');
  const [status, setStatus] = useState<any>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [entity, setEntity] = useState('Element');
  const [executions, setExecutions] = useState<any[]>([]);
  const [tree, setTree] = useState<LogNode | null>(null);
  const [message, setMessage] = useState('Ready');
  const [working, setWorking] = useState(false);
  const [last, setLast] = useState<any>(null);

  async function get(url: string) {
    const r = await fetch(url, { cache: 'no-store' });
    const j = await r.json();
    if (!r.ok) throw Error(j.error || 'Request failed');
    return j;
  }

  async function refresh() {
    try {
      const s = await get('/api/poc?action=status');
      setStatus(s);
      if (s.initialized) {
        const history = await get('/api/poc?action=executions');
        setExecutions(history);
        if (!history.length) { setTree(null); setLast(null); }
        setRows(await get('/api/poc?action=entities&name=' + entity));
      } else {
        setRows([]); setExecutions([]); setTree(null);
      }
    } catch (e) { setMessage(String(e)); }
  }

  useEffect(() => { refresh(); }, []);
  useEffect(() => {
    if (status?.initialized) get('/api/poc?action=entities&name=' + entity)
      .then(setRows).catch(e => setMessage(String(e)));
  }, [entity]);

  async function action(route: string, payload: object = {}) {
    setWorking(true);
    setMessage('Running ' + route + '...');
    try {
      const r = await fetch('/api/poc?action=' + route, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-poc-token': token },
        body: JSON.stringify(payload),
      });
      const j = await r.json();
      if (!r.ok) throw Error(j.error || 'Request failed');
      setMessage(j.message || j.status || 'Completed');
      if (route === 'clear-logs') { setTree(null); setLast(null); setExecutions([]); }
      if (route === 'run-case') {
        setLast(j);
        setMessage(`Case ${j.caseId}: ${j.result}, ${j.failures} failed attempts`);
        if (j.rootId) setTree(await get('/api/poc?action=execution&id=' + j.rootId));
      }
      await refresh();
      if (route === 'run-case' && j.rootId) setTree(await get('/api/poc?action=execution&id=' + j.rootId));
    } catch (e) { setMessage(e instanceof Error ? e.message : String(e)); }
    finally { setWorking(false); }
  }

  function remove() {
    if (window.confirm('Delete every POC table and all logs? This cannot be undone.')) {
      const confirm = window.prompt('Type DELETE POC DATABASE to continue');
      if (confirm === 'DELETE POC DATABASE') action('delete', { confirm });
    }
  }

  async function selectExecution(id: string) {
    try { setTree(await get('/api/poc?action=execution&id=' + id)); }
    catch (e) { setMessage(String(e)); }
  }

  const elementRecords = entity === 'Element' ? orderElements(rows) : rows.slice(0, 100);
  const columns = entity === 'Element' ? elementColumns : Object.keys(rows[0] ?? {});

  return <main className="shell" style={{ width: 'calc(100% - 32px)', maxWidth: '1600px', marginInline: 'auto' }}>
    <header>
      <div><div className="eyebrow">WORKFLOW DESK TEST ENVIRONMENT</div><h1>EQUITAS <span>POC</span></h1><p>Database administration · Five scenarios · Persisted hierarchical logs</p></div>
      <div className="state">{status?.initialized ? '● Database initialized' : '○ Database not initialized'}</div>
    </header>

    <section className="card">
      <div className="section-title"><h2>Environment Controls</h2><span>Local POC only</span></div>
      <label className="token">Admin token <input type="password" placeholder="POC_ADMIN_TOKEN" value={token} onChange={e => setToken(e.target.value)} /></label>
      <div className="actions">
        <button disabled={working} onClick={() => action('initialize')}>Initialize Database</button>
        <button disabled={working} className="danger" onClick={remove}>Delete Database</button>
        <button disabled={working} className="neutral" onClick={() => { if (window.confirm('Remove all execution logs?')) action('clear-logs'); }}>Clear Execution Logs</button>
        <button disabled={working} className="neutral" onClick={() => action('hop')}>Connect Apache Hop</button>
      </div>
      <p className="feedback">{message}</p>
    </section>

    <section className="card">
      <div className="section-title"><h2>Database Entities</h2><span>Live PostgreSQL counts</span></div>
      <div className="stats">{entities.map(n => <button key={n} className={entity === n ? 'stat active' : 'stat'} onClick={() => setEntity(n)}><b>{status?.counts?.[n] ?? '—'}</b><span>{n}</span></button>)}</div>
      <h3>{entity} Records</h3>
      <div className="table-wrap" style={entity === 'Element' ? { width: '100%', maxWidth: '100%', maxHeight: 'none', overflowX: 'auto', overflowY: 'visible' } : undefined}>
        <table style={entity === 'Element' ? { width: '100%', minWidth: '960px', tableLayout: 'fixed', borderCollapse: 'collapse' } : undefined}>
          {entity === 'Element' && <colgroup><col style={{ width: '24%' }}/><col style={{ width: '23%' }}/><col style={{ width: '12%' }}/><col style={{ width: '20%' }}/><col style={{ width: '7%' }}/><col style={{ width: '14%' }}/></colgroup>}
          <thead><tr>{columns.map(k => <th key={k} style={entity === 'Element' ? { padding: '9px 10px', whiteSpace: 'nowrap', textAlign: k === 'Order' ? 'center' : 'left' } : undefined}>{k}</th>)}</tr></thead>
          <tbody>{elementRecords.map((r, i) => {
            const type = asCode(r.Type ?? r.type).toUpperCase();
            const indent = type === 'STEP' ? 26 : type === 'INTEGRATION' ? 13 : 0;
            return <tr key={asCode(r.Id ?? r.id) || i} style={entity === 'Element' ? { height: 33 } : undefined}>
              {columns.map(k => <td key={k} title={display(r[k])} style={entity === 'Element' ? { padding: '6px 10px', lineHeight: '18px', height: 33, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: k === 'Order' ? 'center' : 'left', fontWeight: k === 'Name' && type !== 'STEP' ? 700 : undefined, paddingLeft: k === 'Name' ? 10 + indent : undefined } : undefined}>{k === 'Name' && indent ? <><span style={{ opacity: .65, marginRight: 5 }}>↳</span>{display(r[k])}</> : display(r[k])}</td>)}
            </tr>;
          })}</tbody>
        </table>
        {!rows.length && <p className="empty">No records available</p>}
      </div>
    </section>

    <section className="card">
      <div className="section-title"><h2>Desk Test Execution</h2><span>Independent persisted runs</span></div>
      <div className="cases">{cases.map((title, i) => <div className="case" key={i}><div><span className="eyebrow">CASE {i + 1}</span><strong>{title}</strong></div><button disabled={working || !status?.initialized} onClick={() => action('run-case', { caseId: i + 1 })}>Run Case</button></div>)}</div>
      {last && <div className="result"><b>Latest run:</b> {last.title} · {last.result} · {last.failures} failed attempts{Array.isArray(last.events) && <div className="table-wrap"><table><thead><tr>{Object.keys(last.events[0] ?? {}).map(k => <th key={k}>{k}</th>)}</tr></thead><tbody>{last.events.map((r: Row, i: number) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j}>{display(v)}</td>)}</tr>)}</tbody></table></div>}</div>}
    </section>

    <section className="card">
      <div className="section-title"><h2>Execution Logs</h2><button className="neutral" onClick={refresh}>Refresh</button></div>
      <div className="history">{executions.map(x => <button key={x.id} onClick={() => selectExecution(x.id)} className="history-item"><span>{x.details || x.element}</span><b className={x.status === 'SUCCESS' ? 'ok' : 'bad'}>{x.status}</b><small>{x.startedAt}</small></button>)}</div>
      {!executions.length && <p className="empty">Run a case to see its persisted logs.</p>}
      {tree && <div className="logtree"><h3>Parent-Child Log Tree</h3><LogBranch node={tree}/></div>}
    </section>
  </main>;
}
