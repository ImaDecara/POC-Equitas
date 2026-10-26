import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import {
  OneToMany,
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { Element } from './element';
import { LogStatus } from './logStatus';

@Entity({ tableName: 'log' })
export class Log {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  Id!: string;

  @Property({ fieldName: 'started_at', type: 'Date' })
  StartedAt: Date = new Date();

  @Property({ fieldName: 'finished_at', type: 'Date', nullable: true })
  FinishedAt?: Date;

  @ManyToOne(() => LogStatus, { inversedBy: 'Log' })
  Status!: Rel<LogStatus>;

  @ManyToOne(() => Element, { inversedBy: 'Logs' })
  Element!: Rel<Element>;

  // Relación recursiva: un Log puede tener un Log padre (ejecución contenedora).
  @ManyToOne(() => Log, { nullable: true, inversedBy: 'Children' })
  Parent?: Rel<Log>;

  // Permite navegar desde el Log padre hacia sus subejecuciones.
  @OneToMany(() => Log, (log) => log.Parent)
  Children = new Collection<Log>(this);

  @Property({ fieldName: 'value', type: 'text', nullable: true })
  Value?: string;
}