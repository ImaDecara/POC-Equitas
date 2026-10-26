import 'reflect-metadata';
import { closeOrm } from '../db/orm';
import { MikroORMTesterApp } from './MikroORMTesterApp';

async function main() {
  try {
    await MikroORMTesterApp.StartTestingProcess();
  } catch (error) {
    console.error('Tester execution error:', error);
    process.exitCode = 1;
  } finally {
    await closeOrm();
  }
}

main();