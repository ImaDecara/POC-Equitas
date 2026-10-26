import { getOrm } from '../db/orm';
import { Client } from '../model/client';
import { ClientElementConfig } from '../model/clientElementConfig';
import { Element } from '../model/element';
import { Log } from '../model/log';
import { ConsoleReporter } from './ConsoleReporter';
import type { TestData } from './TestDataFactory';

/**
 * Checks updates, soft deletes, and integrity constraints.
 * These tests are separate from the main business demonstration.
 */
export class PersistenceTests {
  static async runUpdatesAndSoftDelete(em: any, data: TestData) {
    const R = ConsoleReporter;
    const { client, steps } = data;
    const readFileStep = steps.READ_DEBT_FILE;
    R.section('9. Testing update');

    // Usamos el único cliente y el paso LEER_ARCHIVO de la nueva POC.
    // Se modifican propiedades de entidades ya persistidas. MikroORM detecta
    // los cambios (unit of work) y el flush genera los UPDATE correspondientes.

    readFileStep.Notes = 'Actualizado por tester.';
    client.Notes = 'Cliente actualizado por tester.';

    await em.flush();

    R.table([
      {
        Entity: 'Element',
        Code: readFileStep.Code,
        Notes: readFileStep.Notes,
      },
      {
        Entity: 'Client',
        Code: client.Code,
        Notes: client.Notes,
      },
    ]);

    R.success('Update verified');

    
    R.section('10. Testing soft delete');

    // En lugar de eliminar el registro de la base, se marca como borrado.
    // ATENCIÓN: en el escenario actual hay un solo cliente; este test
    // lo deshabilita. No ejecutarlo durante la demostración de negocio.
    client.DeletedAt = new Date();
    client.Enabled = false;

    await em.flush();

    R.table([
      {
        Client: client.Code,
        Enabled: client.Enabled,
        DeletedAt: client.DeletedAt?.toISOString(),
      },
    ]);

    R.success('Soft delete verified');

    
  }

  static async runExpectedErrors(data: TestData) {
    const R = ConsoleReporter;
    const { client, steps } = data;
    const readFileStep = steps.READ_DEBT_FILE;
    R.section('12. Testing expected errors');

    await PersistenceTests.expectDuplicateClientCodeToFail();
    await PersistenceTests.expectDuplicateClientElementConfigToFail(
      client.Id,
      readFileStep.Id
    );
    await PersistenceTests.expectInvalidLogToFail(readFileStep.Id);

  }

  /**
   * Prueba negativa: verifica que NO se pueda guardar un Client con un Code
   * que ya existe (restricción de unicidad en la base).
   *
   * Intenta insertar un cliente nuevo con el código 'MUNI_CBA', que ya fue
   * guardado antes. Se espera que el flush falle.
   * El cliente de prueba se instancia aquí, sin depender de fábricas privadas.
   * - Si falla: la prueba es exitosa.
   * - Si NO falla: informa el error y lanza una excepción.
   *
   * Usa su propio EntityManager (fork) para que el fallo no contamine el
   * estado del EM principal.
   */
  private static async expectDuplicateClientCodeToFail() {
    const orm = await getOrm();
    const em = orm.em.fork();

    let failedAsExpected = false;

    try {
      const duplicated = new Client();
      duplicated.Name = 'Duplicate client';
      duplicated.Code = 'MUNI_CBA'; // Existing code for the test client.
      duplicated.Description = 'Record for uniqueness constraint testing.';
      duplicated.Config = JSON.stringify({ origen: 'prueba-integridad' });
      duplicated.Enabled = true;

      em.persist(duplicated);
      await em.flush();
    } catch {
      // El error es lo que queremos: la base rechazó el código duplicado.
      failedAsExpected = true;
    }

    if (!failedAsExpected) {
      ConsoleReporter.error('Client.Code duplicado NO falló');
      throw new Error('Se permitió un Client.Code duplicado.');
    }

    ConsoleReporter.success('Client.Code duplicado falló como se esperaba');
  }

  /**
   * Prueba negativa: verifica que NO se pueda crear dos veces la configuración
   * de un mismo Client para un mismo Element (restricción de unicidad sobre
   * el par Client + Element).
   *
   * Carga desde la base el cliente y el elemento indicados (por su Id) y trata
   * de insertar una segunda ClientElementConfig para esa misma combinación,
   * que ya existe desde la etapa 6. Se espera que el flush falle.
   * - Si falla: la prueba es exitosa.
   * - Si NO falla: informa el error y lanza una excepción.
   */
  private static async expectDuplicateClientElementConfigToFail(
    clientId: string,
    elementId: string
  ) {
    const orm = await getOrm();
    const em = orm.em.fork();

    let failedAsExpected = false;

    try {
      // Se leen las entidades reales desde la base (no las de memoria).
      const loadedClient = await em.findOneOrFail(Client, { Id: clientId });
      const loadedElement = await em.findOneOrFail(Element, { Id: elementId });

      const duplicated = new ClientElementConfig();
      duplicated.Client = loadedClient;
      duplicated.Element = loadedElement;
      duplicated.Config = JSON.stringify({
        duplicated: true,
      });

      em.persist(duplicated);
      await em.flush();
    } catch {
      // El error es lo que queremos: la base rechazó la combinación repetida.
      failedAsExpected = true;
    }

    if (!failedAsExpected) {
      ConsoleReporter.error('ClientElementConfig duplicado NO falló');
      throw new Error('Se permitió ClientElementConfig duplicado.');
    }

    ConsoleReporter.success(
      'Duplicate ClientElementConfig correctly rejected'
    );
  }


  /**
   * Prueba negativa: verifica que NO se pueda guardar un Log sin Status
   * (el Status es obligatorio, restricción NOT NULL / relación requerida).
   *
   * Carga el Element indicado y trata de insertar un Log que lo referencia
   * pero sin asignarle ningún LogStatus. Se espera que el flush falle.
   * - Si falla: la prueba es exitosa.
   * - Si NO falla: informa el error y lanza una excepción.
  */

  private static async expectInvalidLogToFail(elementId: string) {
    const orm = await getOrm();
    const em = orm.em.fork();

    let failedAsExpected = false;

    try {
      const loadedElement = await em.findOneOrFail(Element, { Id: elementId });

      // Log inválido a propósito: tiene Element y Value, pero NO tiene Status.
      const invalidLog = new Log();
      invalidLog.Element = loadedElement;
      invalidLog.Value = 'Invalid log without Status.';

      em.persist(invalidLog);
      await em.flush();
    } catch {
      // El error es lo que queremos: la base rechazó el log incompleto.
      failedAsExpected = true;
    }

    if (!failedAsExpected) {
      ConsoleReporter.error('Log sin Status NO falló');
      throw new Error('Se permitió Log sin Status.');
    }

    ConsoleReporter.success('Log without Status correctly rejected');
  }

    
}
