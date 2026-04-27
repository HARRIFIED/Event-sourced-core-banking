import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ProjectionRunnerService } from '../infrastructure/projections/projection-runner.service';

async function main(): Promise<void> {
  const [, , scope, id] = process.argv;
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const projectionRunner = app.get(ProjectionRunnerService);

    if (scope === 'all') {
      await projectionRunner.rebuildAll();
      console.log('Projection rebuild completed for all accounts.');
      return;
    }

    if (scope === 'account' && id) {
      await projectionRunner.rebuildAccount(id);
      console.log(`Projection rebuild completed for account ${id}.`);
      return;
    }

    if (scope === 'transfer' && id) {
      await projectionRunner.rebuildTransfer(id);
      console.log(`Projection rebuild completed for transfer ${id}.`);
      return;
    }

    console.error('Usage: npm run projections:rebuild -- all');
    console.error('   or: npm run projections:rebuild -- account <accountId>');
    console.error('   or: npm run projections:rebuild -- transfer <transferId>');
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
