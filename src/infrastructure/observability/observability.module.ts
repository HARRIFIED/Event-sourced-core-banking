import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InfrastructureModule } from '../infrastructure.module';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';
import { ObservabilityPollerService } from './observability-poller.service';
import { ObservabilityService } from './observability.service';

@Global()
@Module({
  imports: [InfrastructureModule],
  controllers: [MetricsController],
  providers: [
    ObservabilityService,
    ObservabilityPollerService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
