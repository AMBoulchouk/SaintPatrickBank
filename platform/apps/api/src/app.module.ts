import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller.js';
import { createDatabasePool, DatabasePool } from '@spbk/infrastructure';

@Module({
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
