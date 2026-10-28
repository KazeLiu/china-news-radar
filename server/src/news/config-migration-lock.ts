import { ConflictException } from '@nestjs/common';

let busy = false;
export function configurationMigrationInProgress() { return busy; }
export function assertNoConfigurationMigration() { if (busy) throw new ConflictException('正在迁移配置，请等待完成后再修改'); }
export function lockConfigurationMigration() {
  assertNoConfigurationMigration(); busy = true;
  return () => { busy = false; };
}
