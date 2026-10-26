import { Collection } from '@mikro-orm/core';
import {
  Entity,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { ClientElementConfig } from './clientElementConfig';

@Entity({ tableName: 'client' })
export class Client {
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

  @Property({ fieldName: 'config', type: 'text', nullable: true })
  Config?: string;

  @OneToMany(() => ClientElementConfig, (config) => config.Client)
  ElementConfigs = new Collection<ClientElementConfig>(this);
}