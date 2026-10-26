import { Cascade, Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { ClientElementConfig } from './clientElementConfig';
import { ElementType } from './elementType';
import { Log } from './log';

@Entity({ tableName: 'element' })
export class Element {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  Id!: string;

  @Property({ fieldName: 'name', type: 'string' })
  Name!: string;

  @Property({ fieldName: 'code', type: 'string', unique: true })
  Code!: string;

  @Property({ fieldName: 'description', type: 'text', nullable: true })
  Description?: string;

  @Property({ fieldName: 'notes', type: 'text', nullable: true })
  Notes?: string;

  @Property({ fieldName: 'enabled', type: 'boolean' })
  Enabled: boolean = true;

  @Property({ fieldName: 'created_at', type: 'Date' })
  CreatedAt: Date = new Date();

  @Property({
    fieldName: 'updated_at',
    type: 'Date',
    onUpdate: () => new Date(),
  })
  UpdatedAt: Date = new Date();

  @Property({ fieldName: 'deleted_at', type: 'Date', nullable: true })
  DeletedAt?: Date;

  // Order of execution among elements sharing the same parent (starts at 1).
  @Property({ fieldName: 'execution_order', type: 'number', nullable: true })
  ExecutionOrder: number | null = null;

  // Template parameters shared by all clients unless overridden.
  @Property({ fieldName: 'default_config', type: 'text' })
  DefaultConfig: string = '{}';

  @Property({ fieldName: 'path', type: 'text', nullable: true })
  Path?: string;

  @ManyToOne(() => Element, {
    nullable: true,
    inversedBy: 'FallbackReferences',
  })
  Fallback?: Rel<Element>;

  @Property({ fieldName: 'max_attempts_before_fallback', type: 'number' })
  MaxAttempsBeforeFallback: number = 0;

  @Property({ fieldName: 'max_attempts_before_failure', type: 'number' })
  MaxAttempsBeforeFailure: number = 3;

  @Property({ fieldName: 'interval_between_attempts', type: 'number' })
  IntervalBetweenAttemps: number = 0;

  @ManyToOne(() => Element, {
    nullable: true,
    inversedBy: 'Children',
  })
  Parent?: Rel<Element>;

  @ManyToOne(() => ElementType, { inversedBy: 'Elements' })
  Type!: Rel<ElementType>;

  @OneToMany(() => Log, (log) => log.Element, {
    cascade: [Cascade.ALL],
    orphanRemoval: true,
  })
  Logs = new Collection<Log>(this);

  @OneToMany(() => Element, (element) => element.Fallback)
  FallbackReferences = new Collection<Element>(this);

  @OneToMany(() => Element, (element) => element.Parent)
  Children = new Collection<Element>(this);

  @OneToMany(() => ClientElementConfig, (config) => config.Element)
  ClientConfigs = new Collection<ClientElementConfig>(this);
}