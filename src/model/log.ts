import type { Rel } from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { Element } from './element';
import { LogStatus } from './logStatus';

@Entity({ tableName: 'log' })
export class Log {
  // Identificador secuencial para consultar y ordenar registros de ejecución.
  @PrimaryKey({ type: 'bigint', autoincrement: true })
  Id!: string;

  @Property({ fieldName: 'started_at', type: 'Date' })
  StartedAt: Date = new Date();

  @Property({ fieldName: 'finished_at', type: 'Date', nullable: true })
  FinishedAt?: Date;

  @ManyToOne(() => LogStatus, { inversedBy: 'Log' })
  Status!: Rel<LogStatus>;

  @ManyToOne(() => Element, { inversedBy: 'Logs' })
  Element!: Rel<Element>;

  @Property({ fieldName: 'value', type: 'text', nullable: true })
  Value?: string;
}
