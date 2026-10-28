import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { createDatabasePool, DatabasePool } from '@spbk/infrastructure';

@Module({
  imports: [AccountsModule],
  controllers: [HealthController],
  providers: [
    {
      provide: 'DATABASE_POOL',
      useFactory: (): DatabasePool => createDatabasePool(),
    },
  ],
  exports: ['DATABASE_POOL'],
})
export class AppModule {}

