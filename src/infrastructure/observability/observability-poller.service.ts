import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { ObservabilityService } from './observability.service';

const POLL_INTERVAL_MS = 5000;

@Injectable()
export class ObservabilityPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityPollerService.name);
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly observability: ObservabilityService,
    @Inject('PG_POOL') private readonly pool: Pool,
  ) {}

  onModuleInit(): void {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'postgres') {
      return;
    }

    this.isRunning = true;
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    await this.loopPromise;
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.collectOutboxMetrics();
      } catch (error) {
        this.logger.warn(
          `Observability polling failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async collectOutboxMetrics(): Promise<void> {
    const result = await this.pool.query<{
      pending_count: string;
      oldest_age_seconds: string | null;
    }>(
      `SELECT
         COUNT(*)::text AS pending_count,
         COALESCE(EXTRACT(EPOCH FROM NOW() - MIN(created_at)), 0)::text AS oldest_age_seconds
       FROM outbox_events
       WHERE published_at IS NULL`,
    );

    const row = result.rows[0];
    this.observability.setOutboxBacklog(
      Number(row?.pending_count ?? 0),
      Number(row?.oldest_age_seconds ?? 0),
    );
  }
}
