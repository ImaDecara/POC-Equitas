import 'server-only';

import { getOrm } from '../db/orm';
import { Client } from '../model/client';
import { ClientElementConfig } from '../model/clientElementConfig';
import { Element } from '../model/element';
import { Log } from '../model/log';
import { LogStatus } from '../model/logStatus';
import type { ExecutionExecutor, ExecutionRequest, ExecutionResult } from './contracts';

type ClientExecution = {
  executionId: string;
  clientId: string;
  clientCode: string;
  status: 'SUCCESS' | 'FAILED';
  message: string;
  executedElements: number;
};

/**
 * Generic hierarchy engine. It reads the persisted Element tree and delegates
 * final operations to an executor without knowing the external tool.
 */
export class ExecutionEngine {
  constructor(private readonly executor: ExecutionExecutor) {}

  async run(request: ExecutionRequest) {
    if (!request.typeId || !request.elementId) {
      throw new Error('Type ID and Element ID are required');
    }

    const orm = await getOrm();
    const em = orm.em.fork();
    const start = await em.findOne(Element, { Id: request.elementId }, { populate: ['Type'] });
    if (!start) throw new Error('Requested element was not found');
    if (start.Type.Id !== request.typeId) throw new Error('The element does not belong to the requested type');
    if (!start.Enabled || start.DeletedAt) throw new Error('The requested element is not enabled');
    if (start.Type.IsFinal) throw new Error('A final element cannot start an execution');

    const clients = await this.resolveClients(em, start, request.clientId);
    const finalElements = await this.resolveFinalElements(em, start);
    const statuses = await this.loadStatuses(em);
    const executions: ClientExecution[] = [];

    for (const client of clients) {
      executions.push(await this.runForClient(em, start, finalElements, client, statuses));
    }

    return {
      message: `${executions.length} client execution(s) completed`,
      executions,
    };
  }

  /** Select one explicit client or every enabled client configured for the start element. */
  private async resolveClients(em: any, start: Element, clientId?: string): Promise<Client[]> {
    const configurations: ClientElementConfig[] = await em.find(
      ClientElementConfig,
      { Element: start },
      { populate: ['Client'] },
    );
    const eligible = configurations
      .map(configuration => configuration.Client)
      .filter(client => client.Enabled && !client.DeletedAt);

    if (clientId) {
      const client = eligible.find(item => item.Id === clientId);
      if (!client) throw new Error('The requested client has no configuration for this element');
      return [client];
    }
    if (!eligible.length) throw new Error('No enabled clients are configured for this element');
    return eligible;
  }

  /** Traverse descendants through Parent and return only final operations in ExecutionOrder. */
  private async resolveFinalElements(em: any, start: Element): Promise<Element[]> {
    const elements: Element[] = await em.find(Element, { Enabled: true }, { populate: ['Parent', 'Type'] });
    const childrenByParent = new Map<string, Element[]>();
    for (const element of elements) {
      const parentId = element.Parent?.Id;
      if (!parentId) continue;
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), element]);
    }
    const order = (element: Element) => element.ExecutionOrder ?? Number.MAX_SAFE_INTEGER;
    const visited = new Set<string>();
    const visit = (element: Element): Element[] => {
      if (visited.has(element.Id)) throw new Error('Invalid cycle in the Element hierarchy');
      visited.add(element.Id);
      const children = [...(childrenByParent.get(element.Id) ?? [])].sort((a, b) => order(a) - order(b));
      if (element.Type.IsFinal) return [element];
      if (!children.length) throw new Error(`Non-final element ${element.Code} has no children to execute`);
      return children.flatMap(visit);
    };
    const finalElements = visit(start);
    if (!finalElements.length) throw new Error('The requested element has no final operations');
    return finalElements;
  }

  /** Merge element defaults with the optional configuration override of one client. */
  private async effectiveConfiguration(em: any, client: Client, element: Element): Promise<Record<string, unknown>> {
    const override = await em.findOne(ClientElementConfig, { Client: client, Element: element });
    return { ...this.parseConfiguration(element.DefaultConfig, element.Code), ...this.parseConfiguration(override?.Config, element.Code) };
  }

  private parseConfiguration(raw: string | undefined, elementCode: string): Record<string, unknown> {
    if (!raw) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // The error below gives the caller the element responsible for the invalid data.
    }
    throw new Error(`Invalid JSON configuration for ${elementCode}`);
  }

  private async loadStatuses(em: any) {
    const rows: LogStatus[] = await em.find(LogStatus, { Code: { $in: ['SUCCESS', 'FAILED'] } });
    const success = rows.find(status => status.Code === 'SUCCESS');
    const failed = rows.find(status => status.Code === 'FAILED');
    if (!success || !failed) throw new Error('SUCCESS and FAILED log statuses are required');
    return { success, failed };
  }

  /** Execute final elements for a single client and persist only finished log records. */
  private async runForClient(
    em: any,
    start: Element,
    finalElements: Element[],
    client: Client,
    statuses: { success: LogStatus; failed: LogStatus },
  ): Promise<ClientExecution> {
    const root = new Log();
    root.Element = start;
    root.Status = statuses.success;
    root.StartedAt = new Date();
    root.Value = `Execution started for client ${client.Code}`;
    em.persist(root);
    await em.flush();

    let status: 'SUCCESS' | 'FAILED' = 'SUCCESS';
    let message = 'Execution completed';
    let executedElements = 0;

    for (const element of finalElements) {
      const startedAt = new Date();
      let result: ExecutionResult;
      try {
        result = await this.executor.execute({
          executionId: String(root.Id),
          client,
          element,
          configuration: await this.effectiveConfiguration(em, client, element),
        });
      } catch (error) {
        result = { status: 'FAILED', message: error instanceof Error ? error.message : 'Executor failed unexpectedly' };
      }

      const log = new Log();
      log.Element = element;
      log.Status = result.status === 'SUCCESS' ? statuses.success : statuses.failed;
      log.StartedAt = startedAt;
      log.FinishedAt = new Date(Math.max(Date.now(), startedAt.getTime() + 1));
      log.Value = JSON.stringify({ executionId: String(root.Id), clientId: client.Id, client: client.Code, message: result.message });
      em.persist(log);
      executedElements++;

      if (result.status === 'FAILED') {
        status = 'FAILED';
        message = result.message;
        break;
      }
    }

    root.Status = status === 'SUCCESS' ? statuses.success : statuses.failed;
    root.FinishedAt = new Date(Math.max(Date.now(), root.StartedAt.getTime() + 1));
    root.Value = JSON.stringify({ executionId: String(root.Id), clientId: client.Id, client: client.Code, message, executedElements });
    await em.flush();

    return { executionId: String(root.Id), clientId: client.Id, clientCode: client.Code, status, message, executedElements };
  }
}
