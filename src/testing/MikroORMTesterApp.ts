import { getOrm } from '../db/orm';
import { ConsoleReporter } from './ConsoleReporter';
import { TestDataFactory } from './TestDataFactory';
import { ExecutionSimulator } from './ExecutionSimulator';

/** Coordinates one business workflow with five independent executions. */
export class MikroORMTesterApp {
  static async StartTestingProcess() {
    const orm = await getOrm();
    const R = ConsoleReporter;
    R.title('EQUITAS - CONFIGURABLE WORKFLOW EXECUTION');
    R.section('1. Refreshing the TEST database schema');

    // DANGER: refresh drops all existing tables and data in the configured schema.
    // Run only against the test database, never production.
    await orm.schema.refresh();
    // Enforce unique execution order only between children of the same parent.
    // These indexes are recreated each time the isolated test schema is refreshed.
    await orm.em.getConnection().execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_element_parent_execution_order
      ON element (parent_id, execution_order) WHERE parent_id IS NOT NULL AND execution_order IS NOT NULL
    `);
    // Root nodes do not need a global unique-order index.
    // The demo creates only one SERVICE root.
    const em = orm.em.fork();
    const datos = await TestDataFactory.createAndPersist(em);

    // The integrated simulator is the desk test: no separate runner is required.
    await ExecutionSimulator.run(em, datos);
    R.title('WORKFLOW DEMONSTRATION COMPLETED');
  }
}
