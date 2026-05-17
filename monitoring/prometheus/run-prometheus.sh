#!/bin/sh
set -eu

APP_TARGET="${PROMETHEUS_APP_TARGET:-host.docker.internal:3000}"

sed "s|__PROMETHEUS_APP_TARGET__|${APP_TARGET}|g" \
  /etc/prometheus/prometheus.yml.tpl \
  > /tmp/prometheus.yml

exec /bin/prometheus \
  --config.file=/tmp/prometheus.yml \
  --storage.tsdb.path=/prometheus
