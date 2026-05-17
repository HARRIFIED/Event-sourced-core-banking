import { Controller, Get, Header } from '@nestjs/common';
import { ObservabilityService } from './observability.service';

@Controller()
export class MetricsController {
  constructor(private readonly observability: ObservabilityService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  getMetrics(): string {
    return this.observability.renderPrometheusMetrics();
  }
}
