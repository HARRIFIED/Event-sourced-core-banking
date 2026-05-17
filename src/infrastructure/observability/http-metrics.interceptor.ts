import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { ObservabilityService } from './observability.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly observability: ObservabilityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; route?: { path?: string }; url?: string }>();
    const response = http.getResponse<{ statusCode?: number }>();
    const route = request.route?.path ?? request.url ?? 'unknown';

    if (route === '/metrics' || route === 'metrics') {
      return next.handle();
    }

    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
        const method = request.method ?? 'UNKNOWN';
        const statusCode = response.statusCode ?? 500;

        this.observability.recordHttpRequest(method, route, statusCode, durationSeconds);
      }),
    );
  }
}
