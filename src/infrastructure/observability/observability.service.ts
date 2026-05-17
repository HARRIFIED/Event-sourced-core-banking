import { Injectable } from '@nestjs/common';
import { MetricsRegistry } from './metrics.registry';

@Injectable()
export class ObservabilityService {
  private readonly registry = new MetricsRegistry();
  private readonly startedAt = Date.now();

  private readonly httpRequestsTotal = this.registry.createCounter(
    'core_banking_http_requests_total',
    'Total HTTP requests handled by the API',
    ['method', 'route', 'status_code'],
  );

  private readonly httpRequestDurationSeconds = this.registry.createHistogram(
    'core_banking_http_request_duration_seconds',
    'HTTP request latency in seconds',
    ['method', 'route', 'status_code'],
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  );

  private readonly outboxMessagesPublishedTotal = this.registry.createCounter(
    'core_banking_outbox_messages_published_total',
    'Total outbox messages published successfully',
    ['topic'],
  );

  private readonly outboxPublishFailuresTotal = this.registry.createCounter(
    'core_banking_outbox_publish_failures_total',
    'Total outbox publish failures',
    ['topic'],
  );

  private readonly outboxClaimBatchSize = this.registry.createHistogram(
    'core_banking_outbox_claim_batch_size',
    'Number of outbox messages claimed per polling cycle',
    [],
    [0, 1, 5, 10, 25, 50, 100, 250],
  );

  private readonly outboxPendingMessages = this.registry.createGauge(
    'core_banking_outbox_pending_messages',
    'Current number of unpublished outbox messages',
  );

  private readonly outboxOldestPendingAgeSeconds = this.registry.createGauge(
    'core_banking_outbox_oldest_pending_age_seconds',
    'Age in seconds of the oldest unpublished outbox message',
  );

  private readonly kafkaConsumerMessagesTotal = this.registry.createCounter(
    'core_banking_kafka_consumer_messages_total',
    'Total Kafka messages processed by application consumers',
    ['consumer', 'topic', 'outcome'],
  );

  private readonly kafkaConsumerProcessingDurationSeconds = this.registry.createHistogram(
    'core_banking_kafka_consumer_processing_duration_seconds',
    'Kafka consumer message processing duration in seconds',
    ['consumer', 'topic', 'outcome'],
    [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  );

  private readonly transferProcessingTotal = this.registry.createCounter(
    'core_banking_transfer_processing_total',
    'Total transfer processing attempts by stage and outcome',
    ['stage', 'outcome'],
  );

  private readonly transferProcessingDurationSeconds = this.registry.createHistogram(
    'core_banking_transfer_processing_duration_seconds',
    'Transfer stage processing duration in seconds',
    ['stage', 'outcome'],
    [0.001, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  );

  private readonly transferOutcomesTotal = this.registry.createCounter(
    'core_banking_transfer_outcomes_total',
    'Total terminal transfer outcomes recorded by the coordinator',
    ['status'],
  );

  private readonly processStartTimeSeconds = this.registry.createGauge(
    'process_start_time_seconds',
    'Start time of the process since unix epoch in seconds',
  );

  private readonly processUptimeSeconds = this.registry.createGauge(
    'process_uptime_seconds',
    'Process uptime in seconds',
  );

  private readonly processResidentMemoryBytes = this.registry.createGauge(
    'process_resident_memory_bytes',
    'Resident memory size in bytes',
  );

  private readonly processHeapTotalBytes = this.registry.createGauge(
    'process_heap_total_bytes',
    'V8 heap total size in bytes',
  );

  private readonly processHeapUsedBytes = this.registry.createGauge(
    'process_heap_used_bytes',
    'V8 heap used size in bytes',
  );

  private readonly processExternalMemoryBytes = this.registry.createGauge(
    'process_external_memory_bytes',
    'Node.js external memory usage in bytes',
  );

  private readonly processArrayBuffersBytes = this.registry.createGauge(
    'process_array_buffers_bytes',
    'Node.js array buffer memory usage in bytes',
  );

  private readonly processCpuUserSecondsTotal = this.registry.createGauge(
    'process_cpu_user_seconds_total',
    'Total user CPU time spent in seconds',
  );

  private readonly processCpuSystemSecondsTotal = this.registry.createGauge(
    'process_cpu_system_seconds_total',
    'Total system CPU time spent in seconds',
  );

  constructor() {
    this.processStartTimeSeconds.set({}, this.startedAt / 1000);
  }

  recordHttpRequest(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = {
      method: method.toUpperCase(),
      route,
      status_code: String(statusCode),
    };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSeconds);
  }

  recordOutboxClaimBatch(size: number): void {
    this.outboxClaimBatchSize.observe({}, size);
  }

  recordOutboxPublishSuccess(topic: string): void {
    this.outboxMessagesPublishedTotal.inc({ topic });
  }

  recordOutboxPublishFailure(topic: string): void {
    this.outboxPublishFailuresTotal.inc({ topic });
  }

  setOutboxBacklog(pendingMessages: number, oldestAgeSeconds: number): void {
    this.outboxPendingMessages.set({}, pendingMessages);
    this.outboxOldestPendingAgeSeconds.set({}, oldestAgeSeconds);
  }

  recordKafkaMessage(consumer: string, topic: string, outcome: 'success' | 'failure', durationSeconds: number): void {
    const labels = { consumer, topic, outcome };
    this.kafkaConsumerMessagesTotal.inc(labels);
    this.kafkaConsumerProcessingDurationSeconds.observe(labels, durationSeconds);
  }

  recordTransferStage(stage: 'debit' | 'credit' | 'compensation', outcome: 'success' | 'failure', durationSeconds: number): void {
    const labels = { stage, outcome };
    this.transferProcessingTotal.inc(labels);
    this.transferProcessingDurationSeconds.observe(labels, durationSeconds);
  }

  recordTransferOutcome(status: 'COMPLETED' | 'FAILED' | 'COMPENSATED'): void {
    this.transferOutcomesTotal.inc({ status });
  }

  renderPrometheusMetrics(): string {
    this.collectProcessMetrics();
    return `${this.registry.render()}\n`;
  }

  private collectProcessMetrics(): void {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.processUptimeSeconds.set({}, process.uptime());
    this.processResidentMemoryBytes.set({}, usage.rss);
    this.processHeapTotalBytes.set({}, usage.heapTotal);
    this.processHeapUsedBytes.set({}, usage.heapUsed);
    this.processExternalMemoryBytes.set({}, usage.external);
    this.processArrayBuffersBytes.set({}, usage.arrayBuffers);
    this.processCpuUserSecondsTotal.set({}, cpuUsage.user / 1_000_000);
    this.processCpuSystemSecondsTotal.set({}, cpuUsage.system / 1_000_000);
  }
}
