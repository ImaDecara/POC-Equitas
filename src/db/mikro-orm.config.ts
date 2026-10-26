import { config as loadEnv } from 'dotenv';
import { defineConfig } from '@mikro-orm/postgresql';
import { Client } from '../model/client';
import { ClientElementConfig } from '../model/clientElementConfig';
import { Element } from '../model/element';
import { ElementType } from '../model/elementType';
import { Log } from '../model/log';
import { LogStatus } from '../model/logStatus';

loadEnv({ path: '.env.local' });

function requiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Falta configurar la variable de entorno: ${name}`);
  }

  return value;
}

export default defineConfig({
  host: requiredEnv('DATABASE_HOST'),
  port: Number(requiredEnv('DATABASE_PORT')),
  dbName: requiredEnv('DATABASE_NAME'),
  user: requiredEnv('DATABASE_USER'),
  password: requiredEnv('DATABASE_PASSWORD'),
  entities: [
    Client,
    ElementType,
    Element,
    ClientElementConfig,
    LogStatus,
    Log,
  ],
  debug: false,
});