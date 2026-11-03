'use client';

import { useEffect, useMemo, useState } from 'react';

type Row = Record<string, unknown>;
type View = 'dashboard' | 'logs' | 'clients' | 'elements' | 'configurations' | 'reference';
type EntityName = 'Client' | 'ElementType' | 'Element' | 'ClientElementConfig' | 'LogStatus' | 'Log';

const entities: EntityName[] = ['Client', 'ElementType', 'Element', 'ClientElementConfig', 'LogStatus', 'Log'];
const scenarios = ['Happy Path', 'Failure Without Fallback', 'Fallback Recovery', 'Session Retry Limit', 'Accumulated Errors'];
const viewItems: Array<{ id: View; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { id: 'logs', label: 'Logs', icon: '▤' },
  { id: 'clients', label: 'Clientes', icon: '♙' },
  { id: 'elements', label: 'Elementos', icon: '◇' },
  { id: 'configurations', label: 'Configuraciones', icon: '⚙' },
  { id: 'reference', label: 'Tablas de referencia', icon: '☷' },
];
const logColumns = ['Id', 'StartedAt', 'FinishedAt', 'Status', 'Element', 'Value'];
const pageSize = 8;

function valueOf(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Activo' : 'Inactivo';
  return String(value);
}

function statusClass(value: unknown): string {
  return String(value).toUpperCase() === 'SUCCESS' ? 'status success' : 'status failed';
}

function datePart(value: unknown): string {
  const raw = valueOf(value);
  return raw.includes(',') ? raw.split(',')[0] : raw.slice(0, 10);
}

/** Convert the API's en-GB date text into a sortable local timestamp. */
function dateTimestamp(value: unknown): number {
  const match = valueOf(value).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!match) return 0;
  return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1])).getTime();
}

function csvCell(value: unknown): string {
  return `"${valueOf(value).replaceAll('"', '""')}"`;
}

/** Build the Element hierarchy using the persisted Parent relation. */
function orderedElements(records: Row[]): Array<{ row: Row; depth: number }> {
  const byParent = new Map<string, Row[]>();
  const roots: Row[] = [];
  const order = (row: Row) => Number(row.Order ?? 9999);
  for (const row of records) {
    const parent = valueOf(row.Parent);
    if (parent === '-' || parent === '—') roots.push(row);
    else byParent.set(parent, [...(byParent.get(parent) ?? []), row]);
  }
  const output: Array<{ row: Row; depth: number }> = [];
  const visit = (row: Row, depth: number) => {
    output.push({ row, depth });
    (byParent.get(valueOf(row.Code)) ?? []).sort((a, b) => order(a) - order(b)).forEach(child => visit(child, depth + 1));
  };
  roots.sort((a, b) => order(a) - order(b)).forEach(root => visit(root, 0));
  return output;
}

export default function EquitasAdmin() {
  const [activeView, setActiveView] = useState<View>('dashboard');
  const [records, setRecords] = useState<Record<string, Row[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState('Listo para consultar la base de datos.');
  const [token, setToken] = useState('');
  const [variant, setVariant] = useState('SERVICE');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [logPage, setLogPage] = useState(1);
  const [dashboardDays, setDashboardDays] = useState(7);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [referenceTab, setReferenceTab] = useState<'types' | 'statuses'>('types');

  /** Fetch all read-only data required by the administrative views. */
  async function refreshData() {
    setLoading(true);
    try {
      const statusResponse = await fetch('/api/poc?action=status', { cache: 'no-store' });
      const status = await statusResponse.json();
      if (!statusResponse.ok) throw new Error(status.error || 'No se pudo consultar el estado de la base.');
      setInitialized(Boolean(status.initialized));
      setCounts(status.counts ?? {});
      if (!status.initialized) {
        setRecords({});
        return;
      }
      const result = await Promise.all(entities.map(async entity => {
        const response = await fetch(`/api/poc?action=entities&name=${entity}`, { cache: 'no-store' });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `No se pudo consultar ${entity}.`);
        return [entity, body as Row[]] as const;
      }));
      setRecords(Object.fromEntries(result));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshData(); }, []);

  /** Perform a protected POC action and refresh the visible persisted data. */
  async function runAction(action: string, body: Record<string, unknown> = {}) {
    setWorking(true);
    setMessage('Procesando…');
    try {
      const response = await fetch(`/api/poc?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-poc-token': token },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'La operación no se pudo completar.');
      if (action === 'run-case') {
        setMessage(`Caso ${result.caseId}: ${result.result}. Intentos fallidos: ${result.failures}.`);
      } else {
        setMessage(result.message || 'Operación completada.');
      }
      await refreshData();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setWorking(false);
    }
  }

  /** Download the current log list without adding a server-side export endpoint. */
  function exportLogs(rows: Row[]) {
    const content = [logColumns.join(','), ...rows.map(row => logColumns.map(column => csvCell(row[column])).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'equitas-logs.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const clients = records.Client ?? [];
  const elements = records.Element ?? [];
  const configurations = records.ClientElementConfig ?? [];
  const elementTypes = records.ElementType ?? [];
  const logStatuses = records.LogStatus ?? [];
  const logs = records.Log ?? [];
  const elementByCode = useMemo(() => new Map(elements.map(row => [valueOf(row.Code), row])), [elements]);
  const selectedLog = logs.find(row => valueOf(row.Id) === selectedLogId) ?? null;

  const visibleLogs = useMemo(() => logs.filter(row => {
    const element = elementByCode.get(valueOf(row.Element));
    const matchesVariant = variant === 'ALL' || valueOf(element?.Type).toUpperCase() === variant;
    const matchesFilters = logColumns.every(column =>
      valueOf(row[column]).toLowerCase().includes((filters[column] ?? '').toLowerCase()));
    return matchesVariant && matchesFilters;
  }), [logs, elementByCode, filters, variant]);

  const dashboardLogs = useMemo(() => {
    if (dashboardDays === 0 || !logs.length) return logs;
    const newest = Math.max(...logs.map(row => dateTimestamp(row.StartedAt)));
    const cutoff = newest - (dashboardDays - 1) * 24 * 60 * 60 * 1000;
    return logs.filter(row => dateTimestamp(row.StartedAt) >= cutoff);
  }, [logs, dashboardDays]);

  const logSummary = useMemo(() => {
    const success = dashboardLogs.filter(row => valueOf(row.Status).toUpperCase() === 'SUCCESS').length;
    return { total: dashboardLogs.length, success, failed: dashboardLogs.length - success };
  }, [dashboardLogs]);

  const dailyCounts = useMemo(() => {
    const grouped = new Map<string, { success: number; failed: number }>();
    for (const row of dashboardLogs) {
      const day = datePart(row.StartedAt);
      const entry = grouped.get(day) ?? { success: 0, failed: 0 };
      if (valueOf(row.Status).toUpperCase() === 'SUCCESS') entry.success++;
      else entry.failed++;
      grouped.set(day, entry);
    }
    return [...grouped.entries()];
  }, [dashboardLogs]);

  const totalLogPages = Math.max(1, Math.ceil(visibleLogs.length / pageSize));
  const safeLogPage = Math.min(logPage, totalLogPages);
  const pagedLogs = visibleLogs.slice((safeLogPage - 1) * pageSize, safeLogPage * pageSize);

  const ordered = useMemo(() => orderedElements(elements), [elements]);
  const activeLabel = viewItems.find(item => item.id === activeView)?.label ?? 'Dashboard';

  function renderDashboard() {
    const maxDay = Math.max(1, ...dailyCounts.flatMap(([, item]) => [item.success, item.failed]));
    const chartMax = Math.max(10, Math.ceil(maxDay / 10) * 10);
    const chartTicks = Array.from({ length: 6 }, (_, index) => chartMax - (chartMax / 5) * index);
    const successPercent = logSummary.total ? Math.round((logSummary.success / logSummary.total) * 100) : 0;
    return <>
      <PageTitle title="Dashboard" detail="Resumen operativo del sistema" actions={<label className="period-select">Período<select value={dashboardDays} onChange={event => setDashboardDays(Number(event.target.value))}><option value={7}>Últimos 7 días</option><option value={30}>Últimos 30 días</option><option value={0}>Todo el historial</option></select></label>} />
      <div className="metric-grid">
        <Metric label="Logs totales" value={logSummary.total} note="En el período seleccionado" tone="blue" icon="▤" />
        <Metric label="Exitosos" value={logSummary.success} note={`${successPercent}% del total`} tone="green" icon="✓" />
        <Metric label="Fallidos" value={logSummary.failed} note={`${100 - successPercent}% del total`} tone="red" icon="×" />
      </div>
      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading"><div><h2>Logs por día</h2><p>Resultados persistidos por fecha de inicio.</p></div><Legend /></div>
          {dailyCounts.length ? <div className="chart-shell"><div className="chart-axis" aria-label="Escala de cantidad de logs">{chartTicks.map(tick => <span key={tick}>{tick}</span>)}</div><div className="bar-chart">{dailyCounts.map(([day, item]) => <div className="bar-group" key={day}>
            <div className="bars"><span className="bar success" style={{ height: `${(item.success / chartMax) * 100}%` }} title={`${item.success} exitosos`} /><span className="bar failed" style={{ height: `${(item.failed / chartMax) * 100}%` }} title={`${item.failed} fallidos`} /></div>
            <small>{day}</small>
          </div>)}</div></div> : <Empty text="Todavía no hay logs para graficar." />}
        </section>
        <section className="panel status-panel">
          <div className="panel-heading"><div><h2>Estado de logs</h2><p>Distribución de resultados finales.</p></div></div>
          <div className="donut-layout"><div className="donut" style={{ background: `conic-gradient(#22b573 0 ${successPercent}%, #f14b5b ${successPercent}% 100%)` }}><div><strong>{logSummary.total}</strong><span>Logs</span></div></div><div className="legend-list"><span><i className="legend-dot success" />SUCCESS <b>{successPercent}% ({logSummary.success})</b></span><span><i className="legend-dot failed" />FAILED <b>{100 - successPercent}% ({logSummary.failed})</b></span></div></div>
        </section>
      </div>
      <section className="panel quick-panel"><div><h2>Administración</h2><p>Datos disponibles: {counts.Client ?? 0} clientes, {counts.Element ?? 0} elementos y {counts.Log ?? 0} logs.</p></div><button className="secondary-button" onClick={() => setActiveView('logs')}>Ver logs</button></section>
      <TestControls token={token} setToken={setToken} initialized={initialized} working={working} message={message} onAction={runAction} />
    </>;
  }

  function renderLogs() {
    return <>
      <PageTitle title="Logs" detail="Listado de logs con variantes de vista y filtros." actions={<button className="primary-button" onClick={() => exportLogs(visibleLogs)}>Exportar CSV</button>} />
      <section className="panel">
        <div className="variant-row"><strong>Ver variante</strong><select value={variant} onChange={event => { setVariant(event.target.value); setLogPage(1); }}><option value="SERVICE">Por servicio (nivel 1)</option><option value="INTEGRATION">Por integración (nivel 2)</option><option value="STEP">Por step (nivel 3)</option><option value="ALL">Todos los niveles</option></select><span>{visibleLogs.length} registros</span></div>
        <div className="data-table-wrap"><table className="data-table logs-table"><thead><tr>{logColumns.map(column => <th key={column}>{column}</th>)}<th>Detalle</th></tr><tr className="filter-row">{logColumns.map(column => <th key={column}><input aria-label={`Filtrar ${column}`} value={filters[column] ?? ''} onChange={event => { setFilters(current => ({ ...current, [column]: event.target.value })); setLogPage(1); }} /></th>)}<th /></tr></thead><tbody>{pagedLogs.map(row => <tr key={valueOf(row.Id)} className={selectedLogId === valueOf(row.Id) ? 'selected-row' : ''}>{logColumns.map(column => <td key={column} onClick={() => setSelectedLogId(valueOf(row.Id))}>{column === 'Status' ? <span className={statusClass(row[column])}>{valueOf(row[column])}</span> : valueOf(row[column])}</td>)}<td><button className="table-action" onClick={() => setSelectedLogId(valueOf(row.Id))} aria-label={`Ver detalle del log ${valueOf(row.Id)}`}>Ver</button></td></tr>)}</tbody></table>{!visibleLogs.length && <Empty text="No hay logs que coincidan con los filtros." />}</div>
        <Pagination page={safeLogPage} pageCount={totalLogPages} total={visibleLogs.length} onChange={setLogPage} />
      </section>
      {selectedLog && <LogDetail log={selectedLog} elementByCode={elementByCode} onClose={() => setSelectedLogId(null)} />}
    </>;
  }

  function renderClients() {
    return <><PageTitle title="Clientes" detail="Clientes configurados para el entorno POC." /><section className="panel"><EntityTable columns={['Id', 'Name', 'Code', 'Enabled', 'Configuration']} rows={clients} empty="No hay clientes cargados." /></section></>;
  }

  function renderElements() {
    return <><PageTitle title="Elementos" detail="Gestión jerárquica de servicios, integraciones y steps." /><section className="panel"><EntityTable columns={['Name', 'Code', 'Type', 'Parent', 'Order', 'Fallback']} rows={ordered.map(({ row, depth }) => ({ ...row, Name: `${'└ '.repeat(depth)}${valueOf(row.Name)}` }))} empty="No hay elementos cargados." /></section></>;
  }

  function renderConfigurations() {
    return <><PageTitle title="Configuraciones" detail="Configuraciones por cliente y elemento en formato JSON." /><section className="panel"><EntityTable columns={['Client', 'Element', 'Configuration', 'Id']} rows={configurations} empty="No hay configuraciones cargadas." /></section></>;
  }

  function renderReference() {
    const rows = referenceTab === 'types' ? elementTypes : logStatuses;
    const columns = referenceTab === 'types' ? ['Id', 'Code', 'Name', 'Parent Type', 'Is Final', 'Enabled'] : ['Id', 'Code', 'Name', 'Description', 'Enabled'];
    return <><PageTitle title="Tablas de referencia" detail="Catálogos que definen la estructura y los estados del sistema." /><section className="panel"><div className="tabs"><button className={referenceTab === 'types' ? 'tab active' : 'tab'} onClick={() => setReferenceTab('types')}>Tipos de elemento</button><button className={referenceTab === 'statuses' ? 'tab active' : 'tab'} onClick={() => setReferenceTab('statuses')}>Estados de log</button></div><EntityTable columns={columns} rows={rows} empty="No hay registros cargados." /></section></>;
  }

  const body = activeView === 'dashboard' ? renderDashboard()
    : activeView === 'logs' ? renderLogs()
      : activeView === 'clients' ? renderClients()
        : activeView === 'elements' ? renderElements()
          : activeView === 'configurations' ? renderConfigurations()
            : renderReference();

  return <main className="admin-app">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">◆</span><strong>EQUITAS</strong></div><nav>{viewItems.slice(0, 2).map(item => <NavItem item={item} active={activeView} onSelect={setActiveView} key={item.id} />)}<p className="nav-heading">Administración</p>{viewItems.slice(2).map(item => <NavItem item={item} active={activeView} onSelect={setActiveView} key={item.id} />)}</nav><div className="sidebar-footer"><span className={initialized ? 'database-dot ready' : 'database-dot'} />{initialized ? 'Base conectada' : 'Base no inicializada'}</div></aside>
    <section className="workspace"><header className="topbar"><div className="mobile-brand">◆ EQUITAS</div><div className="crumb">Administración / <b>{activeLabel}</b></div><div className="topbar-actions"><button className="icon-button" aria-label="Actualizar datos" onClick={refreshData}>↻</button><span className="avatar">AD</span><span className="user-name">Administrador</span></div></header><div className="content">{loading ? <div className="loading">Cargando datos del entorno…</div> : body}</div></section>
  </main>;
}

function NavItem({ item, active, onSelect }: { item: { id: View; label: string; icon: string }; active: View; onSelect: (view: View) => void }) {
  return <button className={active === item.id ? 'nav-item active' : 'nav-item'} onClick={() => onSelect(item.id)}><span>{item.icon}</span>{item.label}</button>;
}

function PageTitle({ title, detail, actions }: { title: string; detail: string; actions?: React.ReactNode }) {
  return <div className="page-title"><div><h1>{title}</h1><p>{detail}</p></div>{actions}</div>;
}

function Metric({ label, value, note, tone, icon }: { label: string; value: number; note: string; tone: string; icon: string }) {
  return <article className={`metric-card ${tone}`}><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div><i>{icon}</i></article>;
}

function Legend() {
  return <div className="legend"><span><i className="legend-dot success" />Success</span><span><i className="legend-dot failed" />Failed</span></div>;
}

function Empty({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>;
}

function EntityTable({ columns, rows, empty }: { columns: string[]; rows: Row[]; empty: string }) {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const filteredRows = useMemo(() => rows.filter(row => columns.every(column => valueOf(row[column]).toLowerCase().includes((filters[column] ?? '').toLowerCase()))), [rows, columns, filters]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);
  return <><div className="data-table-wrap"><table className="data-table"><thead><tr>{columns.map(column => <th key={column}>{column}</th>)}</tr><tr className="filter-row">{columns.map(column => <th key={column}><input aria-label={`Filtrar ${column}`} value={filters[column] ?? ''} onChange={event => { setFilters(current => ({ ...current, [column]: event.target.value })); setPage(1); }} /></th>)}</tr></thead><tbody>{pageRows.map((row, index) => <tr key={valueOf(row.Id) === '—' ? index : valueOf(row.Id)}>{columns.map(column => <td key={column}>{column === 'Enabled' ? <span className={valueOf(row[column]) === 'Activo' ? 'status success' : 'status failed'}>{valueOf(row[column])}</span> : valueOf(row[column])}</td>)}</tr>)}</tbody></table>{!filteredRows.length && <Empty text={empty} />}</div><Pagination page={safePage} pageCount={pageCount} total={filteredRows.length} onChange={setPage} /></>;
}

function Pagination({ page, pageCount, total, onChange }: { page: number; pageCount: number; total: number; onChange: (page: number) => void }) {
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  return <div className="pagination"><div><button disabled={page === 1} onClick={() => onChange(page - 1)}>‹</button>{Array.from({ length: pageCount }, (_, index) => index + 1).slice(0, 5).map(number => <button key={number} className={number === page ? 'active' : ''} onClick={() => onChange(number)}>{number}</button>)}<button disabled={page === pageCount} onClick={() => onChange(page + 1)}>›</button></div><span>Mostrando {start} a {end} de {total} registros</span></div>;
}

function LogDetail({ log, elementByCode, onClose }: { log: Row; elementByCode: Map<string, Row>; onClose: () => void }) {
  const element = elementByCode.get(valueOf(log.Element));
  const path: string[] = [];
  let current = element;
  while (current) {
    path.unshift(valueOf(current.Code));
    const parent = valueOf(current.Parent);
    current = parent === '-' || parent === '—' ? undefined : elementByCode.get(parent);
  }
  return <section className="panel log-detail"><div className="panel-heading"><div><h2>Detalle del log #{valueOf(log.Id)}</h2><p>Campos persistidos y contexto del elemento seleccionado.</p></div><button className="secondary-button" onClick={onClose}>Cerrar</button></div><div className="detail-grid"><div className="detail-context"><span className="detail-label">Contexto del elemento</span>{path.map((item, index) => <div className="context-step" key={item}><span>{index + 1}</span>{item}</div>)}</div><dl>{logColumns.map(column => <div key={column}><dt>{column}</dt><dd>{column === 'Status' ? <span className={statusClass(log[column])}>{valueOf(log[column])}</span> : valueOf(log[column])}</dd></div>)}</dl></div></section>;
}

function TestControls({ token, setToken, initialized, working, message, onAction }: { token: string; setToken: (value: string) => void; initialized: boolean; working: boolean; message: string; onAction: (action: string, body?: Record<string, unknown>) => Promise<void> }) {
  const removeDatabase = () => {
    if (!window.confirm('¿Eliminar todas las tablas y los logs del POC?')) return;
    if (window.prompt('Escribí DELETE POC DATABASE para confirmar') === 'DELETE POC DATABASE') onAction('delete', { confirm: 'DELETE POC DATABASE' });
  };
  return <section className="test-area"><div className="test-heading"><div><span className="eyebrow">ENTORNO TÉCNICO</span><h2>Pruebas de escritorio</h2><p>Los casos quedan fuera de la operación administrativa habitual.</p></div><span className="feedback">{message}</span></div><div className="control-row"><label>Token de administración<input type="password" value={token} placeholder="POC_ADMIN_TOKEN" onChange={event => setToken(event.target.value)} /></label><button className="secondary-button" disabled={working} onClick={() => onAction('initialize')}>Inicializar base</button><button className="secondary-button" disabled={working || !initialized} onClick={() => onAction('clear-logs')}>Limpiar logs</button><button className="secondary-button" disabled={working} onClick={() => onAction('hop')}>Conectar Apache Hop</button><button className="danger-button" disabled={working || !initialized} onClick={removeDatabase}>Eliminar base</button></div><div className="scenario-grid">{scenarios.map((scenario, index) => <article className="scenario" key={scenario}><span>CASO {index + 1}</span><strong>{scenario}</strong><button className="primary-button" disabled={working || !initialized} onClick={() => onAction('run-case', { caseId: index + 1 })}>Run Case</button></article>)}</div></section>;
}
