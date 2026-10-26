import type { Rel } from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/legacy';
import { Client } from './client';
import { Element } from './element';

@Entity({ tableName: 'client_element_config' })
@Unique({
  name: 'uq_client_element_config',
  properties: ['Client', 'Element'],
})
export class ClientElementConfig {
  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  Id!: string;

  @ManyToOne(() => Client, { inversedBy: 'ElementConfigs' })
  Client!: Rel<Client>;

  @Property({ fieldName: 'config', type: 'text' })
  Config!: string;

  @ManyToOne(() => Element, { inversedBy: 'ClientConfigs' })
  Element!: Rel<Element>;
}