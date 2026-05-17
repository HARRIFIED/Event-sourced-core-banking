type LabelValues = Record<string, string>;

type MetricType = 'counter' | 'gauge' | 'histogram';

interface MetricDefinition {
  name: string;
  help: string;
  type: MetricType;
  labelNames: string[];
  render(): string[];
}

interface MetricSample {
  value: number;
  labels: LabelValues;
}

interface HistogramSample {
  bucketCounts: number[];
  count: number;
  sum: number;
  labels: LabelValues;
}

function makeLabelKey(labelNames: string[], labels: LabelValues): string {
  return labelNames.map((name) => `${name}=${labels[name] ?? ''}`).join('|');
}

function toLabelString(labels: LabelValues): string {
  const entries = Object.entries(labels);
  if (entries.length === 0) {
    return '';
  }

  const body = entries
    .map(([key, value]) => `${key}="${escapeLabelValue(value)}"`)
    .join(',');

  return `{${body}}`;
}

function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function sanitizeValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return value;
}

class CounterMetric implements MetricDefinition {
  private readonly samples = new Map<string, MetricSample>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
  ) {}

  get type(): MetricType {
    return 'counter';
  }

  inc(labels: LabelValues = {}, value = 1): void {
    const key = makeLabelKey(this.labelNames, labels);
    const existing = this.samples.get(key);
    const nextValue = sanitizeValue((existing?.value ?? 0) + value);
    this.samples.set(key, {
      value: nextValue,
      labels: this.normalizeLabels(labels),
    });
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];

    for (const sample of this.samples.values()) {
      lines.push(`${this.name}${toLabelString(sample.labels)} ${sample.value}`);
    }

    return lines;
  }

  private normalizeLabels(labels: LabelValues): LabelValues {
    const normalized: LabelValues = {};
    for (const labelName of this.labelNames) {
      normalized[labelName] = labels[labelName] ?? '';
    }

    return normalized;
  }
}

class GaugeMetric implements MetricDefinition {
  private readonly samples = new Map<string, MetricSample>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
  ) {}

  get type(): MetricType {
    return 'gauge';
  }

  set(labels: LabelValues = {}, value: number): void {
    const key = makeLabelKey(this.labelNames, labels);
    this.samples.set(key, {
      value: sanitizeValue(value),
      labels: this.normalizeLabels(labels),
    });
  }

  inc(labels: LabelValues = {}, value = 1): void {
    const key = makeLabelKey(this.labelNames, labels);
    const existing = this.samples.get(key);
    this.samples.set(key, {
      value: sanitizeValue((existing?.value ?? 0) + value),
      labels: this.normalizeLabels(labels),
    });
  }

  dec(labels: LabelValues = {}, value = 1): void {
    this.inc(labels, -value);
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];

    for (const sample of this.samples.values()) {
      lines.push(`${this.name}${toLabelString(sample.labels)} ${sample.value}`);
    }

    return lines;
  }

  private normalizeLabels(labels: LabelValues): LabelValues {
    const normalized: LabelValues = {};
    for (const labelName of this.labelNames) {
      normalized[labelName] = labels[labelName] ?? '';
    }

    return normalized;
  }
}

class HistogramMetric implements MetricDefinition {
  private readonly samples = new Map<string, HistogramSample>();

  constructor(
    public readonly name: string,
    public readonly help: string,
    public readonly labelNames: string[],
    private readonly buckets: number[],
  ) {}

  get type(): MetricType {
    return 'histogram';
  }

  observe(labels: LabelValues = {}, value: number): void {
    const key = makeLabelKey(this.labelNames, labels);
    const sample = this.samples.get(key) ?? {
      bucketCounts: new Array(this.buckets.length).fill(0),
      count: 0,
      sum: 0,
      labels: this.normalizeLabels(labels),
    };
    const sanitizedValue = sanitizeValue(value);

    for (let index = 0; index < this.buckets.length; index += 1) {
      if (sanitizedValue <= this.buckets[index]) {
        sample.bucketCounts[index] += 1;
      }
    }

    sample.count += 1;
    sample.sum += sanitizedValue;
    this.samples.set(key, sample);
  }

  render(): string[] {
    const lines = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    for (const sample of this.samples.values()) {
      for (let index = 0; index < this.buckets.length; index += 1) {
        lines.push(
          `${this.name}_bucket${toLabelString({
            ...sample.labels,
            le: String(this.buckets[index]),
          })} ${sample.bucketCounts[index]}`,
        );
      }

      lines.push(
        `${this.name}_bucket${toLabelString({
          ...sample.labels,
          le: '+Inf',
        })} ${sample.count}`,
      );
      lines.push(`${this.name}_sum${toLabelString(sample.labels)} ${sample.sum}`);
      lines.push(`${this.name}_count${toLabelString(sample.labels)} ${sample.count}`);
    }

    return lines;
  }

  private normalizeLabels(labels: LabelValues): LabelValues {
    const normalized: LabelValues = {};
    for (const labelName of this.labelNames) {
      normalized[labelName] = labels[labelName] ?? '';
    }

    return normalized;
  }
}

export class MetricsRegistry {
  private readonly metrics: MetricDefinition[] = [];

  createCounter(name: string, help: string, labelNames: string[] = []): CounterMetric {
    const metric = new CounterMetric(name, help, labelNames);
    this.metrics.push(metric);
    return metric;
  }

  createGauge(name: string, help: string, labelNames: string[] = []): GaugeMetric {
    const metric = new GaugeMetric(name, help, labelNames);
    this.metrics.push(metric);
    return metric;
  }

  createHistogram(
    name: string,
    help: string,
    labelNames: string[] = [],
    buckets: number[] = [],
  ): HistogramMetric {
    const metric = new HistogramMetric(name, help, labelNames, buckets);
    this.metrics.push(metric);
    return metric;
  }

  render(): string {
    return this.metrics
      .flatMap((metric) => metric.render())
      .join('\n');
  }
}
