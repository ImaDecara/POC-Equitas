import { Client } from '../model/client';
import { ClientElementConfig } from '../model/clientElementConfig';
import { Element } from '../model/element';
import { ElementType } from '../model/elementType';
import { LogStatus } from '../model/logStatus';
import { ConsoleReporter } from './ConsoleReporter';

/** One client, a generic service, two logical integrations and ordered steps. */
export interface TestData {
  client: Client;
  service: Element;
  integrations: Element[];
  steps: Record<string, Element>;
  statuses: {success: LogStatus; failed: LogStatus;};
  configurations: ClientElementConfig[];
}

/** Creates actual ORM entities; business activities executed later are simulations. */
export class TestDataFactory {
  static async createAndPersist(em: any): Promise<TestData> {
    const R = ConsoleReporter;
    R.section('2. Creating element types and log statuses');
    const status = (code: string, description: string) => {
      const item = new LogStatus();
      item.Name = code; item.Code = code; item.Description = description; item.Enabled = true;
      return item;
    };
    const statuses = {
      success: status('SUCCESS', 'Completed'),
      failed: status('FAILED', 'Execution failed'),
    };

    const type = (code: string, parent?: ElementType) => {
      const item = new ElementType();
      item.Name = code; item.Code = code; item.Description = `${code} workflow node`;
      item.IsFinal = code === 'STEP'; item.Enabled = true;
      if (parent) item.ParentType = parent;
      return item;
    };
    const serviceType = type('SERVICE');
    const integrationType = type('INTEGRATION', serviceType);
    const stepType = type('STEP', integrationType);

    R.section('3. Creating client and ordered integration tree');
    const client = new Client();
    client.Name = 'Cordoba Municipality'; client.Code = 'MUNI_CBA';
    client.Description = 'Fictitious client for the EQUITAS demonstration';
    client.Config = JSON.stringify({ environment: 'POC' }); client.Enabled = true;

    // IMPORTANT: ExecutionOrder and DefaultConfig must be mapped in model/element.ts.
    const create = (code: string, t: ElementType, order: number | null, parent?: Element, defaults: Record<string, unknown> = {}) => {
      const element = new Element();
      element.Name = code; element.Code = code;
      element.Description = `Workflow node ${code}`;
      element.Type = t; element.Parent = parent;
      element.Path = parent ? `${parent.Path}.${code}` : code;
      element.Enabled = true;
      element.ExecutionOrder = order;
      element.DefaultConfig = JSON.stringify(defaults);
      element.MaxAttempsBeforeFallback = 2;
      element.MaxAttempsBeforeFailure = 3;
      element.IntervalBetweenAttemps = 10;
      t.Elements.add(element);
      return element;
    };

    // Root service: one complete business process, split into two integrations.
    const service = create('DEBT_PROCESSING', serviceType, 1);
    const importIntegration = create('TANGO_DEBT_FILE_IMPORT', integrationType, 1, service);
    const enrichmentIntegration = create('SAP_BUSINESS_ONE_DIRECT_CONNECTION', integrationType, 2, service);
    const integrations = [importIntegration, enrichmentIntegration];

    // Integration 1: read, validate, normalize and simulate persistence of debts.
    // The last two steps represent a destination write and its verification.
    const steps: Record<string, Element> = {
      OPEN_FILE_SOURCE: create('OPEN_FILE_SOURCE', stepType, 1, importIntegration, { timeoutMs: 30000 }),
      READ_DEBT_FILE: create('READ_DEBT_FILE', stepType, 2, importIntegration, { pageSize: 100 }),
      VALIDATE_DEBT_FILE: create('VALIDATE_DEBT_FILE', stepType, 3, importIntegration, { requireDebtorId: true }),
      NORMALIZE_DEBTS: create('NORMALIZE_DEBTS', stepType, 4, importIntegration, { normalizeAmounts: true }),
      INSERT_DEBTS: create('INSERT_DEBTS', stepType, 5, importIntegration, { target: 'POC_SIMULATED' }),
      VERIFY_DEBT_IMPORT: create('VERIFY_DEBT_IMPORT', stepType, 6, importIntegration, { requireConfirmation: true }),

      // Integration 2: obtain, match and simulate updating debtor records.
      CONNECT_DEBTOR_SOURCE: create('CONNECT_DEBTOR_SOURCE', stepType, 1, enrichmentIntegration, { timeoutMs: 30000 }),
      FETCH_DEBTOR_DATA: create('FETCH_DEBTOR_DATA', stepType, 2, enrichmentIntegration, { batchSize: 100 }),
      MATCH_DEBTORS: create('MATCH_DEBTORS', stepType, 3, enrichmentIntegration, { matchMode: 'strict' }),
      UPDATE_DEBTOR_RECORDS: create('UPDATE_DEBTOR_RECORDS', stepType, 4, enrichmentIntegration, { target: 'POC_SIMULATED' }),
    };
    // Fallback is a backward pointer within the SAME integration.
    // No additional "backup" steps are created and no cross-integration jumps occur.
    steps.VALIDATE_DEBT_FILE.Fallback = steps.READ_DEBT_FILE; // C -> B
    steps.INSERT_DEBTS.Fallback = steps.READ_DEBT_FILE; // E -> B

    // One ClientElementConfig for EACH of the ten existing steps.
    // DefaultConfig belongs to Element; client JSON only contains overrides.
    const overrides: Record<string, Record<string, unknown>> = {
      OPEN_FILE_SOURCE: { timeoutMs: 60000 },
      READ_DEBT_FILE: { pageSize: 250 },
      MATCH_DEBTORS: { minConfidence: 0.95 },
    };
    const configurations = Object.values(steps).map((element) => {
      const cfg = new ClientElementConfig();
      cfg.Client = client; cfg.Element = element;
      cfg.Config = JSON.stringify(overrides[element.Code] ?? {});
      client.ElementConfigs.add(cfg);
      element.ClientConfigs.add(cfg);
      return cfg;
    });

    // Every step belongs to the normal execution path, including fallback targets.
    // A fallback is a backward jump to an earlier step, not a separate node.
    const orderedSteps = [...integrations.flatMap(integration =>
      Object.values(steps).filter(step => step.Parent === integration)
        .sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder))
    )];
    for (const [index, step] of orderedSteps.entries()) {
      if (step.Fallback &&
          (step.Fallback.Parent !== step.Parent ||
           orderedSteps.indexOf(step.Fallback) < 0 ||
           orderedSteps.indexOf(step.Fallback) >= index)) {
        throw new Error(`Fallback must target an earlier step in the same integration: ${step.Code}`);
      }
    }
    for (const parent of [service, ...integrations]) {
      const children = [...integrations, ...Object.values(steps)]
        .filter(element => element.Parent === parent);
      const orders = children.map(element => element.ExecutionOrder);
      const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
      if (JSON.stringify([...orders].sort((a, b) => Number(a) - Number(b))) !== JSON.stringify(expected)) {
        throw new Error(`Invalid consecutive orders under ${parent.Code}`);
      }
    }
    // Persist the hierarchy level by level so PostgreSQL has each parent ID
    // BEFORE its children are inserted. This avoids temporary NULL parent_id
    // values during a bulk insert and makes the hierarchy auditable.
    em.persist([...Object.values(statuses), serviceType, integrationType, stepType, client]);
    await em.flush();

    // Level 1: the only root element (SERVICE).
    em.persist(service);
    await em.flush();

    // Level 2: integrations directly attached to the persisted service.
    em.persist(integrations);
    await em.flush();

    // Level 3: first persist A and B (earlier fallback targets), then the
    // remaining steps. This ensures their database IDs exist before Fallback FKs.
    for (const step of orderedSteps) {
      em.persist(step);
      await em.flush();
    }

    // Exactly one per client and STEP.
    em.persist(configurations);
    await em.flush();

    // Verify that the actual persisted structure matches the business tree.
    // If any step was inserted without a parent, stop with an explicit error.
    const storedElements: Element[] = await em.find(Element, {}, { populate: ['Parent'] });
    const unexpectedRoots = storedElements.filter(element =>
      element.Code !== service.Code && !element.Parent
    );
    if (unexpectedRoots.length > 0) {
      throw new Error(`Invalid persisted hierarchy: unexpected roots: ${unexpectedRoots.map(e => e.Code).join(', ')}`);
    }

    R.table([
      { Entity: 'Client', Count: 1 },
      { Entity: 'Service', Count: 1 },
      { Entity: 'Integration', Count: integrations.length },
      { Entity: 'Step', Count: Object.keys(steps).length },
      { Entity: 'ClientElementConfig', Count: configurations.length },
    ]);
    // The original four-column table shows each persisted element exactly once.
    // Fallback is a BACKWARD reference and does not create a new sequence node.
    const elementRows: Array<{ Element: string; Parent: string; Order: number | string; Fallback: string }> = [];
    const addElementRow = (element: Element) => elementRows.push({
      Element: element.Code,
      Parent: element.Parent?.Code ?? '-',
      Order: element.ExecutionOrder ?? '-',
      Fallback: element.Fallback?.Code ?? '-',
    });
    for (const integration of [...integrations].sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder))) {
      addElementRow(integration);
      for (const step of orderedSteps.filter(s => s.Parent === integration)) addElementRow(step);
    }
    R.section('PERSISTED ELEMENTS (BACKWARD FALLBACK REFERENCES)');
    R.table(elementRows);

    // Separate representation of the SAME persisted elements as a hierarchy.
    // Display the logical workflow as an actual tree, not a flat array.
    // Parent/Children represent hierarchy. Fallback is shown as a reference,
    // not as an additional node, and never points forward.
    const treeRows: object[] = [];
    const append = (element: Element, label: string, kind: string) => {
      treeRows.push({ Tree: label, Type: kind, Order: element.ExecutionOrder ?? '-', ElementId: element.Id, ParentId: element.Parent?.Id ?? '-' });
    };
    append(service, service.Code, 'SERVICE');
    for (const integration of [...integrations].sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder))) {
      append(integration, `  ├─ ${integration.Code}`, 'INTEGRATION');
      const mainSteps = Object.values(steps)
        .filter(step => step.Parent === integration)
        .sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder));
      for (const step of mainSteps) {
        append(step, `  │  ├─ ${step.Code}`, 'MAIN STEP');
        // The Fallback column already identifies backward jumps; do not duplicate nodes.
      }
    }
    R.section('PERSISTED WORKFLOW HIERARCHY (BACKWARD FALLBACK REFERENCES)');
    R.table(treeRows);
    R.success('Workflow tree and one configuration per step persisted');
    return { client, service, integrations, steps, statuses, configurations };
  }
}
