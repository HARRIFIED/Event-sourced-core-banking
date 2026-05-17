global:
  scrape_interval: 5s
  evaluation_interval: 5s

scrape_configs:
  - job_name: app
    metrics_path: /metrics
    static_configs:
      - targets:
          - __PROMETHEUS_APP_TARGET__

  - job_name: prometheus
    static_configs:
      - targets:
          - prometheus:9090

  - job_name: cadvisor
    static_configs:
      - targets:
          - cadvisor:8080

  - job_name: postgres-exporter
    static_configs:
      - targets:
          - postgres-exporter:9187

  - job_name: kafka-exporter
    static_configs:
      - targets:
          - kafka-exporter:9308
