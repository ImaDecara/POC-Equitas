import 'server-only';
import { getOrm } from '../db/orm';
import { Client } from '../model/client';
import { Element } from '../model/element';
import { ElementType } from '../model/elementType';
import { ClientElementConfig } from '../model/clientElementConfig';
import { LogStatus } from '../model/logStatus';
import { Log } from '../model/log';
import { TestDataFactory, type TestData } from '../testing/TestDataFactory';
import { ExecutionSimulator } from '../testing/ExecutionSimulator';

// All database actions are SERVER ONLY. Do not invoke them from client components.
// Configure DATABASE_URL and POC_ADMIN_TOKEN in the environment.
export const entityNames = ['Client','ElementType','Element','ClientElementConfig','LogStatus','Log'] as const;
export type EntityName = typeof entityNames[number];
const models = { Client, ElementType, Element, ClientElementConfig, LogStatus, Log };
let busy = false;
export async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Another database operation is already running');
  busy = true;
  try { return await action(); } finally { busy = false; }
}
function safe(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safe);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      if (/password|secret|credential|token/i.test(k)) continue;
      const v = o[k];
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) {
        out[k] = (v as {Id?:string; Code?:string}).Code ?? (v as {Id?:string}).Id ?? '[relation]';
      } else out[k] = safe(v);
    }
    return out;
  }
  return value;
}
export async function overview() {
  const orm = await getOrm(); const em = orm.em.fork();
  try {
    const counts: Record<string,number> = {};
    for (const name of entityNames) counts[name] = await em.count(models[name] as any, {});
    return { initialized: true, counts };
  } catch { return { initialized: false, counts: {} }; }
}
export async function initializeDb() {
  const orm = await getOrm();
  // Creating/updating the schema here is NOT the destructive schema.refresh().
  await orm.schema.update();
  const em = orm.em.fork();
  const existing = await em.count(Element, {});
  if (existing) throw new Error('Database already has elements. Delete the POC schema before initializing again.');
  await TestDataFactory.createAndPersist(em);
  return { message: 'POC schema and seed data initialized' };
}
export async function deleteDb() {
  const orm = await getOrm();
  // Destructive operation, limited to the configured POC database/schema.
  await orm.schema.drop();
  return { message: 'POC tables deleted' };
}
export async function clearLogs() {
  const orm = await getOrm();
  // Remove only execution history. TRUNCATE also clears recursive parent-child logs.
  // Do not use CASCADE: no other entity should be deleted by this operation.
  const before = await orm.em.fork().count(Log, {});
  await orm.em.getConnection().execute('TRUNCATE TABLE "log"');
  const remaining = await orm.em.fork().count(Log, {});
  if (remaining !== 0) throw new Error(`Log cleanup incomplete: ${remaining} records remain`);
  return { message: `Cleared ${before} execution logs`, deleted: before, remaining };
}

async function loadTestData(em: any): Promise<TestData> {
  const client: Client = await em.findOneOrFail(Client, {Code:'MUNI_CBA'});
  const service: Element = await em.findOneOrFail(Element, {Code:'DEBT_PROCESSING'});
  const integrations: Element[] = await em.find(Element, {Type: {Code:'INTEGRATION'}}, {populate:['Parent','Type']});
  const stepRows: Element[] = await em.find(Element, {Type: {Code:'STEP'}}, {populate:['Parent','Fallback','Type']});
  const steps: Record<string,Element> = Object.fromEntries(stepRows.map(e=>[e.Code,e]));
  const statusRows: LogStatus[] = await em.find(LogStatus, {});
  const status = (name:string) => {const s=statusRows.find(x=>x.Code===name); if(!s)throw new Error('Missing '+name);return s;};
  const configurations: ClientElementConfig[] = await em.find(ClientElementConfig, {}, {populate:['Client','Element']});
  return {client,service,integrations,steps,configurations,statuses:{pending:status('PENDING'),running:status('RUNNING'),success:status('SUCCESS'),failed:status('FAILED')}};
}
export async function runCase(caseId: number) {
  if (![1,2,3,4,5].includes(caseId)) throw new Error('Invalid case ID');
  const orm=await getOrm(); const em=orm.em.fork();
  const data=await loadTestData(em);
  return await ExecutionSimulator.runOne(em,data,caseId);
}
/** Return display-ready scalar columns instead of full ORM relationship objects. */
export async function listEntity(name: EntityName) {
  const orm = await getOrm();
  const em = orm.em.fork();
  const relationFields: Record<EntityName, string[]> = {
    Client: [], ElementType: ['ParentType'],
    Element: ['Parent', 'Fallback', 'Type'],
    ClientElementConfig: ['Client', 'Element'],
    LogStatus: [], Log: ['Parent', 'Parent.Element', 'Element', 'Status'],
  };
  const rows: any[] = await em.find(models[name] as any, {}, {
    limit: 500,
    populate: relationFields[name] as any,
  });
  const label = (value: any) => value?.Name || value?.Code || value?.Id || '-';
  const configText = (value: unknown) => {
    if (typeof value !== 'string') return '-';
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
        return Object.entries(parsed).map(([key, val]) => `${key}: ${typeof val === 'object' ? JSON.stringify(val) : String(val)}`).join(' | ') || '-';
    } catch { /* Display non-JSON configuration as ordinary text. */ }
    return value || '-';
  };
  const date = (d: Date | undefined) => d ? new Date(d).toLocaleString('en-GB', { hour12: false }) : '-';
  return rows.map((r: any) => {
    switch (name) {
      case 'Client': return { Name: r.Name, Code: r.Code, Description: r.Description ?? '-', Enabled: r.Enabled, Configuration: configText(r.Config), Id: r.Id };
      case 'ElementType': return { Name: r.Name, Code: r.Code, 'Parent Type': label(r.ParentType), Description: r.Description ?? '-', 'Is Final': r.IsFinal, Enabled: r.Enabled, Id: r.Id };
      case 'Element': return { Name: r.Name, Code: r.Code, Type: label(r.Type), Parent: label(r.Parent), Order: r.ExecutionOrder ?? '-', Fallback: label(r.Fallback), 'Max Before Fallback': r.MaxAttempsBeforeFallback, 'Max Before Failure': r.MaxAttempsBeforeFailure, 'Default Config': configText(r.DefaultConfig), Id: r.Id };
      case 'ClientElementConfig': return { Client: label(r.Client), Element: label(r.Element), Configuration: configText(r.Config), Id: r.Id };
      case 'LogStatus': return { Name: r.Name, Code: r.Code, Description: r.Description ?? '-', Enabled: r.Enabled, Id: r.Id };
      case 'Log': return { Element: label(r.Element), Status: label(r.Status), 'Parent Log': r.Parent ? `${label(r.Parent.Element)} (${r.Parent.Id.slice(0, 8)})` : 'Root execution', Started: date(r.StartedAt), Finished: date(r.FinishedAt), Details: r.Value ?? '-', Id: r.Id };
    }
  });
}

export async function executionList() {
  const orm=await getOrm();const em=orm.em.fork();
  const roots:Log[]=await em.find(Log, {Parent:null} as any, {populate:['Element','Status'],orderBy:{StartedAt:'DESC'}, limit:50});
  return roots.map(r=>({id:r.Id,element:r.Element.Code,status:r.Status.Code,startedAt:r.StartedAt.toISOString(),finishedAt:r.FinishedAt?.toISOString(),details:r.Value}));
}
export async function executionTree(rootId:string) {
  const orm=await getOrm();const em=orm.em.fork();
  const rows:Log[]=await em.find(Log, {}, {populate:['Element','Status','Parent'], limit:5000});
  const root=rows.find(r=>r.Id===rootId && !r.Parent);
  if(!root) throw new Error('Execution not found');
  const grouped=new Map<string,Log[]>();
  for(const l of rows) if(l.Parent)grouped.set(l.Parent.Id,[...(grouped.get(l.Parent.Id)??[]),l]);
  const visit=(l:Log,depth:number):any=>({id:l.Id,parentId:l.Parent?.Id??null,element:l.Element.Code,status:l.Status.Code,startedAt:l.StartedAt.toISOString(),finishedAt:l.FinishedAt?.toISOString(),details:l.Value,depth,children:(grouped.get(l.Id)??[]).sort((a,b)=>a.StartedAt.getTime()-b.StartedAt.getTime()).map(c=>visit(c,depth+1))});
  return visit(root,0);
}
