import { Element } from '../model/element';
import { Log } from '../model/log';
import { LogStatus } from '../model/logStatus';
import { ClientElementConfig } from '../model/clientElementConfig';
import { ConsoleReporter as R } from './ConsoleReporter';
import type { TestData } from './TestDataFactory';

type CaseId = 1 | 2 | 3 | 4 | 5;
type Result = 'SUCCESS' | 'FAILED';
interface CaseSpec {
  id: CaseId;
  title: string;
  expected: Result;
  // Consecutive failed attempts before a backward fallback is activated.
  cBeforeFallback: number;
  // Accumulated failed attempts at C over all visits in this execution.
  cSessionLimit: number;
  // Case 2 deliberately disables the fallback for C.
  cFallbackEnabled: boolean;
}

/**
 * POC workflow executor: business operations are SIMULATED.
 * Each Log represents one finished attempt or one aggregate element execution.
 * No Log.Parent or state-transition logs: only VPP fields are stored.
 *
 * Definitions used here:
 * - Failed attempt: an operation that returns FAILED (not an additional retry).
 * - Consecutive counter: resets after a successful execution of the step.
 * - Session counter: NEVER resets while this case is running, even on fallback.
 * - Fallback: go BACKWARD to an existing, earlier element in normal order.
 */
export class ExecutionSimulator {
  private static cases: CaseSpec[] = [
    { id: 1, title: 'CASE 1 - Happy path', expected: 'SUCCESS', cBeforeFallback: 5, cSessionLimit: 5, cFallbackEnabled: false },
    { id: 2, title: 'CASE 2 - C fails 5 times, no fallback', expected: 'FAILED', cBeforeFallback: 5, cSessionLimit: 5, cFallbackEnabled: false },
    { id: 3, title: 'CASE 3 - C fails 5 times, fallback B, recovery', expected: 'SUCCESS', cBeforeFallback: 5, cSessionLimit: 10, cFallbackEnabled: true },
    { id: 4, title: 'CASE 4 - C fails 3 per cycle, session limit 9', expected: 'FAILED', cBeforeFallback: 3, cSessionLimit: 9, cFallbackEnabled: true },
    { id: 5, title: 'CASE 5 - C accumulates 4 + 1 after E falls back to B', expected: 'FAILED', cBeforeFallback: 5, cSessionLimit: 5, cFallbackEnabled: false },
  ];

  /** Compose the effective configuration for a client and a STEP. */
  private static config(step: Element, data: TestData): Record<string, unknown> {
    const row: ClientElementConfig | undefined = data.configurations.find(c => c.Element === step);
    if (!row) throw new Error(`Missing client configuration for ${step.Code}`);
    return { ...JSON.parse(step.DefaultConfig || '{}'), ...JSON.parse(row.Config || '{}') };
  }

  /** Build the element path without modifying the entity. */
  private static path(element: Element): string {
    const parts: string[] = [];
    const seen = new Set<Element>();
    for (let p: Element | undefined = element; p; p = p.Parent) {
      if (seen.has(p)) throw new Error('Invalid cycle in Element.Parent');
      seen.add(p);
      parts.unshift(p.Code);
    }
    return parts.join('.');
  }

  /** Create one final-result Log. No extra attributes or Log.Parent relation. */
  private static createLog(element: Element, detail: string): Log {
    const log = new Log();
    log.Element = element;
    log.StartedAt = new Date();
    log.Value = detail;
    return log;
  }

  /** Assign the final status and finishing timestamp to a log. */
  private static finish(log: Log, status: LogStatus, detail: string) {
    log.Status = status;
    log.FinishedAt = new Date(Math.max(Date.now(), log.StartedAt.getTime() + 1));
    log.Value = detail;
  }

  /** Execute a single case for the Next.js dashboard without resetting the database. */
  static async runOne(em: any, data: TestData, caseId: number) {
    const spec = this.cases.find(c => c.id === caseId);
    if (!spec) throw new Error('Invalid desk test case');
    return this.runCase(em, data, spec);
  }

  /** Run all five desk tests, one independent root log per test case. */
  static async run(em: any, data: TestData) {
    const summary: object[] = [];
    for (const spec of this.cases) {
      const outcome = await this.runCase(em, data, spec);
      const verified = outcome.result === spec.expected;
      summary.push({ Case: spec.id, Scenario: spec.title, Expected: spec.expected,
        Actual: outcome.result, FailedAttempts: outcome.failures, Logs: outcome.logs,
        Verification: verified ? 'PASS' : 'FAIL' });
      if (!verified) throw new Error(`Failed desk test: ${spec.title}, got ${outcome.result}`);
    }
    R.section('SUMMARY - FIVE DESK TESTS');
    R.table(summary);
    R.success('Five POC cases verified against their expected outcomes');
  }

  /** Simulate the ordered steps, retries and backward fallbacks. */
  private static async runCase(em: any, data: TestData, spec: CaseSpec) {
    R.section(spec.title);
    R.step(`Client: ${data.client.Code} | Service: ${data.service.Code}`);

    // Ordered normal path. No artificial backup elements are created.
    const steps: Element[] = [...data.integrations]
      .sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder))
      .flatMap(integration => Object.values(data.steps)
        .filter(step => step.Parent === integration)
        .sort((a, b) => Number(a.ExecutionOrder) - Number(b.ExecutionOrder)));
    const indexOf = (code: string) => steps.findIndex(step => step.Code === code);
    if (steps.length !== 10 || indexOf('VALIDATE_DEBT_FILE') !== 2 || indexOf('INSERT_DEBTS') !== 4) {
      throw new Error('The five desk tests require A->B->C->D->E->F within TANGO_DEBT_FILE_IMPORT');
    }
    // Validate that fallbacks target an earlier step in the same integration.
    for (const [i, step] of steps.entries()) {
      if (step.Fallback &&
          (step.Fallback.Parent !== step.Parent ||
           steps.indexOf(step.Fallback) < 0 ||
           steps.indexOf(step.Fallback) >= i)) {
        throw new Error(`Fallback is not backward: ${step.Code} -> ${step.Fallback.Code}`);
      }
    }

    const root = this.createLog(data.service, `Start ${spec.title}`);
    const completedLogs: Log[] = [root];
    let currentIntegration: Element | undefined;
    let integrationLog: Log | undefined;
    let position = 0;
    let failures = 0;
    let result: Result = 'SUCCESS';
    const failuresByStep: Record<string, number> = {};
    const visits: Record<string, number> = {};
    let operationCount = 0;
    const maxOperations = 100; // In-memory safety guard; not a Log attribute.

    while (position < steps.length && operationCount < maxOperations) {
      const step = steps[position];
      const integration = step.Parent;
      if (!integration) throw new Error(`Step has no integration: ${step.Code}`);
      if (currentIntegration !== integration) {
        // Track each visit to an integration with a separate completed Log.
        if (integrationLog) {
          this.finish(integrationLog, data.statuses.success, 'Integration traversal completed');
        }
        currentIntegration = integration;
        integrationLog = this.createLog(integration,
          `Entering integration for ${spec.title}`);
        completedLogs.push(integrationLog);
      }
      if (!integrationLog) throw new Error('Missing integration log');
      visits[step.Code] = (visits[step.Code] ?? 0) + 1;
      const visit = visits[step.Code];
      const cfg = this.config(step, data);


      // CASE 5: INSERT_DEBTS (E) has a backward fallback to READ_DEBT_FILE (B).
      // Cases 2/3/4: C exhibits the corresponding retry/fallback policies.
      const targetFailures = step.Code === 'VALIDATE_DEBT_FILE'
        ? (spec.id === 2 ? 5 : spec.id === 3 ? (visit === 1 ? 5 : 0)
          : spec.id === 4 ? 3 : spec.id === 5 ? (visit === 1 ? 4 : 1) : 0)
        : (spec.id === 5 && step.Code === 'INSERT_DEBTS' ? 1 : 0);
      const localThreshold = step.Code === 'VALIDATE_DEBT_FILE' ? spec.cBeforeFallback : 1;
      let failedThisVisit = 0;
      let jumpedBackward = false;
      let halted = false;

      // Number of failed attempts is deliberately explicit: 5/5 means five
      // failed operations. The next operation, if allowed, can succeed.
      for (let localAttempt = 1; localAttempt <= targetFailures + 1; localAttempt++) {
        operationCount++;
        if (operationCount > maxOperations) break;
        const fails = localAttempt <= targetFailures;
        const log = this.createLog(step,
          `Attempt ${localAttempt}, visit ${visit}, case ${spec.id}`);
        completedLogs.push(log);
        if (!fails) {
          this.finish(log, data.statuses.success,
            `SUCCESS (simulated operation) | visit=${visit} | attempt=${localAttempt} | configuration=${JSON.stringify(cfg)}`);
          position++;
          break;
        }
        failedThisVisit++;
        failures++;
        failuresByStep[step.Code] = (failuresByStep[step.Code] ?? 0) + 1;
        const sessionFailures = failuresByStep[step.Code];
        let action = 'Retry same step';
        // Check cumulative C limit BEFORE authorizing another fallback.
        if (step.Code === 'VALIDATE_DEBT_FILE' && sessionFailures >= spec.cSessionLimit) {
          action = `STOP: C session limit ${sessionFailures}/${spec.cSessionLimit}`;
          halted = true;
        } else if (step.Code === 'VALIDATE_DEBT_FILE' &&
                   failedThisVisit >= localThreshold && spec.cFallbackEnabled && step.Fallback) {
          action = `BACKWARD FALLBACK to ${step.Fallback.Code}`;
          const backward = steps.indexOf(step.Fallback);
          if (backward < 0 || backward >= position) throw new Error('Invalid backward fallback');
          position = backward;
          jumpedBackward = true;
        } else if (step.Code === 'VALIDATE_DEBT_FILE' && failedThisVisit >= localThreshold && !spec.cFallbackEnabled &&
                   spec.id === 2) {
          action = 'STOP: no fallback configured for this scenario';
          halted = true;
        } else if (step.Code === 'INSERT_DEBTS' && spec.id === 5 && step.Fallback) {
          action = `BACKWARD FALLBACK to ${step.Fallback.Code}`;
          const backward = steps.indexOf(step.Fallback);
          if (backward < 0 || backward >= position) throw new Error('Invalid backward fallback');
          position = backward;
          jumpedBackward = true;
        }
        this.finish(log, data.statuses.failed,
          `FAILED | visit=${visit} | attempt=${localAttempt} | sessionErrors=${sessionFailures} | action=${action}`);
        if (halted || jumpedBackward) break;
      }
      if (halted) { result = 'FAILED'; break; }
      if (jumpedBackward) continue;
    }
    if (operationCount > maxOperations || (operationCount === maxOperations && position < steps.length)) throw new Error('Execution safety guard exceeded');
    if (integrationLog) {
      this.finish(integrationLog, result === 'SUCCESS' ? data.statuses.success : data.statuses.failed,
        result === 'SUCCESS' ? 'Integration traversal completed' : 'Execution stopped during integration');
    }
    this.finish(root, result === 'SUCCESS' ? data.statuses.success : data.statuses.failed,
      `CASE ${spec.id} | ${result} | failed attempts=${failures} | C session errors=${failuresByStep['VALIDATE_DEBT_FILE'] ?? 0}`);
    // Persist only completed logs; every record has one final Status.
    em.persist(completedLogs);
    await em.flush();
    const logs = completedLogs.length;
    R.section('PERSISTED LOG RECORDS (VPP FIELDS)');
    R.table(completedLogs.map(l => ({
      Id: String(l.Id), StartedAt: l.StartedAt.toISOString(),
      FinishedAt: l.FinishedAt?.toISOString() ?? '-',
      Status: l.Status.Code, Element: l.Element.Code, Value: l.Value ?? '',
    })));
    R.success(`Case ${spec.id} completed: ${result}, failures=${failures}`);
    return { result, failures, logs, rootId: String(root.Id), caseId: spec.id, title: spec.title };
  }
}
