import { Collection } from '@mikro-orm/core';
import type { Rel } from '@mikro-orm/core';
import {
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/decorators/legacy';
import { Element } from './element';

@Entity({ tableName: 'element_type' })
export class ElementType {
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

  @OneToMany(() => Element, (element) => element.Type)
  Elements = new Collection<Element>(this);

  @Property({ fieldName: 'is_final', type: 'boolean' })
  IsFinal: boolean = false;

  @OneToMany(() => ElementType, (type) => type.ParentType)
  ChildTypes = new Collection<ElementType>(this);

  @ManyToOne(() => ElementType, {
    nullable: true,
    inversedBy: 'ChildTypes',
  })
  ParentType?: Rel<ElementType>;
}