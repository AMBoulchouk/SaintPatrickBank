import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemDetailsExceptionFilter } from './common/filters/http-exception.filter.js';
import { StructuredLogger } from '@spbk/infrastructure';

async function bootstrap() {
  const logger = new StructuredLogger('Bootstrap');
  const port = parseInt(process.env.APP_PORT ?? '3000', 10);
  const host = process.env.APP_HOST ?? '127.0.0.1';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false, // delegated to @spbk/infrastructure StructuredLogger
    }),
  );

  app.enableShutdownHooks();
  app.useGlobalFilters(new ProblemDetailsExceptionFilter());

  await app.listen(port, host);
  logger.info(`SaintPatrickBK API Gateway running on http://${host}:${port}`, {
    environment: process.env.NODE_ENV ?? 'development',
    port,
    host,
  });
}

bootstrap().catch((err: unknown) => {
  const errorLogger = new StructuredLogger('BootstrapError');
  errorLogger.error('Failed to start SaintPatrickBK API Gateway', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
