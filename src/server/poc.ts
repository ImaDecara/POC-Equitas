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

export const entityNames = [
  'Client', 'ElementType', 'Element',
  'ClientElementConfig', 'LogStatus', 'Log',
] as const;

export type EntityName = typeof entityNames[number];

const models = { Client, ElementType, Element, ClientElementConfig, LogStatus, Log };
let busy = false;

/** Evita operaciones administrativas simultáneas en este proceso. */
export async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Another database operation is already running');
  busy = true;

  try {
    return await action();
  } finally {
    busy = false;
  }
}

/** Informa el estado de la base y la cantidad de registros por entidad. */
export async function overview() {
  const orm = await getOrm();
  const em = orm.em.fork();

  try {
    const counts: Record<string, number> = {};
    for (const name of entityNames) {
      counts[name] = await em.count(models[name] as any, {});
    }
    return { initialized: true, counts };
  } catch {
    return { initialized: false, counts: {} };
  }
}

/** Crea el esquema y carga los datos ficticios una sola vez. */
export async function initializeDb() {
  const orm = await getOrm();
  await orm.schema.update();
  const em = orm.em.fork();

  if (await em.count(Element, {})) {
    throw new Error('Database already has elements. Delete the POC schema before initializing again.');
  }

  await TestDataFactory.createAndPersist(em);
  return { message: 'POC schema and seed data initialized' };
}

/** Elimina las tablas de la base de pruebas configurada. */
export async function deleteDb() {
  const orm = await getOrm();
  await orm.schema.drop();
  return { message: 'POC tables deleted' };
}

/** Limpia el historial de ejecución sin borrar los elementos. */
export async function clearLogs() {
  const orm = await getOrm();
  const before = await orm.em.fork().count(Log, {});

  await orm.em.getConnection().execute('TRUNCATE TABLE "log" RESTART IDENTITY');

  const remaining = await orm.em.fork().count(Log, {});
  if (remaining !== 0) {
    throw new Error(`Log cleanup incomplete: ${remaining} records remain`);
  }

  return { message: `Cleared ${before} execution logs`, deleted: before, remaining };
}

/** Recupera los elementos y configuraciones usados por el simulador. */
async function loadTestData(em: any): Promise<TestData> {
  const client: Client = await em.findOneOrFail(Client, { Code: 'MUNI_CBA' });
  const service: Element = await em.findOneOrFail(Element, { Code: 'DEBT_PROCESSING' });
  const integrations: Element[] = await em.find(
    Element, { Type: { Code: 'INTEGRATION' } }, { populate: ['Parent', 'Type'] },
  );
  const stepRows: Element[] = await em.find(
    Element, { Type: { Code: 'STEP' } }, { populate: ['Parent', 'Fallback', 'Type'] },
  );
  const steps: Record<string, Element> = Object.fromEntries(
    stepRows.map(element => [element.Code, element]),
  );
  const statusRows: LogStatus[] = await em.find(LogStatus, {});
  const getStatus = (code: string) => {
    const result = statusRows.find(item => item.Code === code);
    if (!result) throw new Error(`Missing ${code}`);
    return result;
  };
  const configurations: ClientElementConfig[] = await em.find(
    ClientElementConfig, {}, { populate: ['Client', 'Element'] },
  );

  return {
    client, service, integrations, steps, configurations,
    statuses: { success: getStatus('SUCCESS'), failed: getStatus('FAILED') },
  };
}

/** Ejecuta uno de los cinco escenarios de escritorio. */
export async function runCase(caseId: number) {
  if (![1, 2, 3, 4, 5].includes(caseId)) {
    throw new Error('Invalid case ID');
  }

  const orm = await getOrm();
  const em = orm.em.fork();
  return ExecutionSimulator.runOne(em, await loadTestData(em), caseId);
}

/** Presenta columnas de las entidades sin exponer objetos ORM completos. */
export async function listEntity(name: EntityName) {
  const orm = await getOrm();
  const em = orm.em.fork();
  const relationFields: Record<EntityName, string[]> = {
    Client: [],
    ElementType: ['ParentType'],
    Element: ['Parent', 'Fallback', 'Type'],
    ClientElementConfig: ['Client', 'Element'],
    LogStatus: [],
    Log: ['Element', 'Status'],
  };

  const rows: any[] = await em.find(models[name] as any, {}, {
    limit: 500,
    populate: relationFields[name] as any,
    ...(name === 'Log' ? { orderBy: { Id: 'ASC' } } : {}),
  });

  const label = (value: any) => value?.Name || value?.Code || value?.Id || '-';
  const configText = (value: unknown) => {
    if (typeof value !== 'string') return '-';
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.entries(parsed).map(([key, item]) =>
          `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`,
        ).join(' | ') || '-';
      }
    } catch {
      // Muestra el texto original si la configuración no es JSON.
    }
    return value || '-';
  };
  const date = (value: Date | undefined) =>
    value ? new Date(value).toLocaleString('en-GB', { hour12: false }) : '-';

  return rows.map((row: any) => {
    switch (name) {
      case 'Client':
        return { Name: row.Name, Code: row.Code, Description: row.Description ?? '-', Enabled: row.Enabled, Configuration: configText(row.Config), Id: row.Id };
      case 'ElementType':
        return { Name: row.Name, Code: row.Code, 'Parent Type': label(row.ParentType), Description: row.Description ?? '-', 'Is Final': row.IsFinal, Enabled: row.Enabled, Id: row.Id };
      case 'Element':
        return { Name: row.Name, Code: row.Code, Type: label(row.Type), Parent: label(row.Parent), Order: row.ExecutionOrder ?? '-', Fallback: label(row.Fallback), 'Max Before Fallback': row.MaxAttempsBeforeFallback, 'Max Before Failure': row.MaxAttempsBeforeFailure, 'Default Config': configText(row.DefaultConfig), Id: row.Id };
      case 'ClientElementConfig':
        return { Client: label(row.Client), Element: label(row.Element), Configuration: configText(row.Config), Id: row.Id };
      case 'LogStatus':
        return { Name: row.Name, Code: row.Code, Description: row.Description ?? '-', Enabled: row.Enabled, Id: row.Id };
      case 'Log':
        return { Id: String(row.Id), StartedAt: date(row.StartedAt), FinishedAt: date(row.FinishedAt), Status: label(row.Status), Element: label(row.Element), Value: row.Value ?? '-' };
    }
  });
}

/** Lista logs del servicio que representan ejecuciones completas. */
export async function executionList() {
  const orm = await getOrm();
  const em = orm.em.fork();
  const roots: Log[] = await em.find(
    Log,
    { Element: { Code: 'DEBT_PROCESSING' } },
    { populate: ['Element', 'Status'], orderBy: { StartedAt: 'DESC' }, limit: 50 },
  );

  return roots.map(log => ({
    id: String(log.Id),
    element: log.Element.Code,
    status: log.Status.Code,
    startedAt: log.StartedAt.toISOString(),
    finishedAt: log.FinishedAt?.toISOString(),
    details: log.Value,
  }));
}

/** Recupera los logs dentro del intervalo temporal de una ejecución. */
export async function executionRecords(rootId: string) {
  // El VPP no define Log.Parent: este criterio temporal sirve para la POC secuencial.
  const orm = await getOrm();
  const em = orm.em.fork();
  const root = await em.findOne(
    Log,
    { Id: rootId, Element: { Code: 'DEBT_PROCESSING' } } as any,
    { populate: ['Element', 'Status'] },
  );

  if (!root || !root.FinishedAt) throw new Error('Completed execution not found');

  const rows: Log[] = await em.find(
    Log,
    { StartedAt: { $gte: root.StartedAt, $lte: root.FinishedAt } } as any,
    { populate: ['Element', 'Status'], orderBy: { StartedAt: 'ASC', Id: 'ASC' }, limit: 5000 },
  );

  return rows.map(log => ({
    Id: String(log.Id),
    StartedAt: log.StartedAt.toISOString(),
    FinishedAt: log.FinishedAt?.toISOString() ?? '-',
    Status: log.Status.Code,
    Element: log.Element.Code,
    Value: log.Value ?? '',
  }));
}
