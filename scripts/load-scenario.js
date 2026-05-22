const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');

function parseArgs(argv) {
  const args = {};

  for (const rawArg of argv) {
    if (!rawArg.startsWith('--')) {
      continue;
    }

    const arg = rawArg.slice(2);
    const [key, value] = arg.split('=');
    args[key] = value ?? 'true';
  }

  return args;
}

function readNumber(args, key, fallback) {
  const value = args[key] ?? process.env[key.toUpperCase().replace(/-/g, '_')];
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value for --${key}: ${value}`);
  }

  return parsed;
}

function readString(args, key, fallback) {
  return args[key] ?? process.env[key.toUpperCase().replace(/-/g, '_')] ?? fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedValues.length) - 1),
  );

  return sortedValues[index];
}

class Metrics {
  constructor() {
    this.startedAt = performance.now();
    this.completed = 0;
    this.failed = 0;
    this.byOperation = new Map();
  }

  record(operation, durationMs, status, ok, message) {
    this.completed += 1;
    if (!ok) {
      this.failed += 1;
    }

    const existing = this.byOperation.get(operation) ?? {
      completed: 0,
      failed: 0,
      latencies: [],
      statuses: new Map(),
      errors: new Map(),
    };

    existing.completed += 1;
    if (!ok) {
      existing.failed += 1;
    }
    existing.latencies.push(durationMs);
    existing.statuses.set(status, (existing.statuses.get(status) ?? 0) + 1);
    if (message) {
      existing.errors.set(message, (existing.errors.get(message) ?? 0) + 1);
    }

    this.byOperation.set(operation, existing);
  }

  printSummary(durationSeconds) {
    const totalMs = performance.now() - this.startedAt;
    const totalSeconds = totalMs / 1000;

    console.log('');
    console.log('=== Load Test Summary ===');
    console.log(`Configured duration: ${durationSeconds}s`);
    console.log(`Actual elapsed: ${totalSeconds.toFixed(2)}s`);
    console.log(`Total completed requests: ${this.completed}`);
    console.log(`Total failed requests: ${this.failed}`);
    console.log(`Average throughput: ${(this.completed / Math.max(totalSeconds, 0.001)).toFixed(2)} req/s`);

    const operations = [...this.byOperation.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    for (const [operation, stats] of operations) {
      const latencies = [...stats.latencies].sort((a, b) => a - b);
      const p50 = percentile(latencies, 50).toFixed(2);
      const p95 = percentile(latencies, 95).toFixed(2);
      const p99 = percentile(latencies, 99).toFixed(2);
      const max = latencies.length === 0 ? '0.00' : latencies[latencies.length - 1].toFixed(2);
      const statuses = [...stats.statuses.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, count]) => `${status}:${count}`)
        .join(', ');
      const topErrors = [...stats.errors.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([message, count]) => `${count}x ${message}`)
        .join(' | ');

      console.log('');
      console.log(`[${operation}]`);
      console.log(`  completed=${stats.completed} failed=${stats.failed}`);
      console.log(`  latency_ms p50=${p50} p95=${p95} p99=${p99} max=${max}`);
      console.log(`  statuses ${statuses || 'none'}`);
      if (topErrors) {
        console.log(`  top_errors ${topErrors}`);
      }
    }
  }
}

function randomBetween(min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return Math.floor(Math.random() * (upper - lower + 1)) + lower;
}

function weightedPick(weights) {
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const target = Math.random() * total;
  let cumulative = 0;

  for (const entry of weights) {
    cumulative += entry.weight;
    if (target <= cumulative) {
      return entry.name;
    }
  }

  return weights[weights.length - 1].name;
}

function sanitizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

async function httpRequest(config, operation, path, options = {}) {
  const headers = {
    'content-type': 'application/json',
    ...options.headers,
  };
  const startedAt = performance.now();

  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const durationMs = performance.now() - startedAt;
    const contentType = response.headers.get('content-type') ?? '';
    const responseBody = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text().catch(() => '');
    const message = response.ok
      ? ''
      : extractErrorMessage(responseBody) || response.statusText || 'request failed';

    config.metrics.record(operation, durationMs, response.status, response.ok, message);
    return {
      ok: response.ok,
      status: response.status,
      body: responseBody,
      durationMs,
      message,
    };
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    const message = error instanceof Error ? error.message : 'unknown network error';
    config.metrics.record(operation, durationMs, 'NETWORK_ERROR', false, message);
    return {
      ok: false,
      status: 'NETWORK_ERROR',
      body: null,
      durationMs,
      message,
    };
  }
}

function extractErrorMessage(body) {
  if (!body) {
    return '';
  }

  if (typeof body === 'string') {
    return body;
  }

  if (typeof body.message === 'string') {
    return body.message;
  }

  if (Array.isArray(body.message)) {
    return body.message.join('; ');
  }

  return JSON.stringify(body);
}

function makeAccount(config, sequence) {
  return {
    accountId: `${config.accountPrefix}-acc-${sequence}`,
    ownerId: `${config.accountPrefix}-owner-${sequence}`,
    currency: config.currency,
    balance: 0,
    frozen: false,
  };
}

function makeTransfer(config, sequence, sourceAccountId, destinationAccountId, amount) {
  return {
    transferId: `${config.accountPrefix}-trf-${sequence}`,
    sourceAccountId,
    destinationAccountId,
    currency: config.currency,
    amount,
    status: 'accepted',
  };
}

function pickAccount(config, options = {}) {
  const activeAccounts = config.accounts.filter((account) => !account.frozen);
  if (activeAccounts.length === 0) {
    return null;
  }

  const minimumBalance = options.minimumBalance ?? 0;
  const candidates = activeAccounts.filter((account) => account.balance >= minimumBalance);
  const pool = candidates.length > 0 ? candidates : activeAccounts;

  const hotCount = Math.max(1, Math.floor(pool.length * config.hotAccountRatio));
  const shouldUseHotPool = pool.length > 1 && Math.random() < config.hotSelectionRate;
  const selectionPool = shouldUseHotPool ? pool.slice(0, hotCount) : pool;

  return selectionPool[randomBetween(0, selectionPool.length - 1)];
}

function pickDistinctAccountPair(config, minimumBalance = 0) {
  const source = pickAccount(config, { minimumBalance });
  if (!source) {
    return null;
  }

  const destinationCandidates = config.accounts.filter(
    (account) => !account.frozen && account.accountId !== source.accountId,
  );
  if (destinationCandidates.length === 0) {
    return null;
  }

  const hotCount = Math.max(1, Math.floor(destinationCandidates.length * config.hotAccountRatio));
  const shouldUseHotPool = destinationCandidates.length > 1 && Math.random() < config.hotSelectionRate;
  const selectionPool = shouldUseHotPool
    ? destinationCandidates.slice(0, hotCount)
    : destinationCandidates;
  const destination = selectionPool[randomBetween(0, selectionPool.length - 1)];

  return { source, destination };
}

async function createAccount(config, account, initialDeposit, operationName = 'createAccount') {
  const createResponse = await httpRequest(config, operationName, '/accounts', {
    method: 'POST',
    headers: {
      'Idempotency-Key': randomUUID(),
    },
    body: {
      accountId: account.accountId,
      ownerId: account.ownerId,
      currency: account.currency,
      actor: 'load-test',
    },
  });

  if (!createResponse.ok) {
    return false;
  }

  config.accounts.push(account);

  if (initialDeposit > 0) {
    const depositResponse = await httpRequest(config, 'seedDeposit', `/accounts/${account.accountId}/deposits`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': randomUUID(),
      },
      body: {
        amount: initialDeposit,
        currency: account.currency,
        transactionId: randomUUID(),
        actor: 'load-test',
      },
    });

    if (depositResponse.ok) {
      account.balance += initialDeposit;
    }
  }

  return true;
}

async function runDeposit(config) {
  const account = pickAccount(config);
  if (!account) {
    return runCreateAccount(config);
  }

  const amount = randomBetween(config.minAmount, config.maxAmount);
  const response = await httpRequest(config, 'deposit', `/accounts/${account.accountId}/deposits`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': randomUUID(),
    },
    body: {
      amount,
      currency: account.currency,
      transactionId: randomUUID(),
      actor: 'load-test',
    },
  });

  if (response.ok) {
    account.balance += amount;
  }
}

async function runWithdrawal(config) {
  const account = pickAccount(config, { minimumBalance: config.minAmount });
  if (!account) {
    return runDeposit(config);
  }

  const maxWithdrawal = Math.max(config.minAmount, Math.min(config.maxAmount, Math.floor(account.balance)));
  const amount = randomBetween(config.minAmount, maxWithdrawal);
  const response = await httpRequest(config, 'withdraw', `/accounts/${account.accountId}/withdrawals`, {
    method: 'POST',
    headers: {
      'Idempotency-Key': randomUUID(),
    },
    body: {
      amount,
      currency: account.currency,
      transactionId: randomUUID(),
      actor: 'load-test',
    },
  });

  if (response.ok) {
    account.balance = Math.max(0, account.balance - amount);
  }
}

async function runBalanceRead(config) {
  const account = pickAccount(config);
  if (!account) {
    return runCreateAccount(config);
  }

  await httpRequest(config, 'getBalance', `/accounts/${account.accountId}/balance`);
}

async function runHistoryRead(config) {
  const account = pickAccount(config);
  if (!account) {
    return runCreateAccount(config);
  }

  await httpRequest(config, 'getHistory', `/accounts/${account.accountId}/history?limit=${config.historyLimit}&offset=0`);
}

async function runCreateAccount(config) {
  const account = makeAccount(config, config.nextAccountSequence++);
  await createAccount(config, account, config.initialDeposit, 'createAccount');
}

async function runInitiateTransfer(config) {
  const pair = pickDistinctAccountPair(config, config.minAmount);
  if (!pair) {
    return runCreateAccount(config);
  }

  const maxTransferAmount = Math.max(
    config.minAmount,
    Math.min(config.maxTransferAmount, Math.floor(pair.source.balance)),
  );
  const amount = randomBetween(config.minAmount, maxTransferAmount);
  const transfer = makeTransfer(
    config,
    config.nextTransferSequence++,
    pair.source.accountId,
    pair.destination.accountId,
    amount,
  );

  const response = await httpRequest(config, 'initiateTransfer', '/transfers', {
    method: 'POST',
    headers: {
      'Idempotency-Key': randomUUID(),
    },
    body: {
      transferId: transfer.transferId,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      amount,
      currency: transfer.currency,
    },
  });

  if (response.ok) {
    config.transfers.push(transfer);
  }
}

async function runTransferStatusRead(config) {
  if (config.transfers.length === 0) {
    return runInitiateTransfer(config);
  }

  const transfer = config.transfers[randomBetween(0, config.transfers.length - 1)];
  const response = await httpRequest(config, 'getTransferStatus', `/transfers/${transfer.transferId}`);
  if (response.ok && response.body && typeof response.body === 'object') {
    transfer.status = response.body.status ?? transfer.status;
    if (config.removeCompletedTransfersFromPool && isTransferTerminal(transfer.status)) {
      config.transfers = config.transfers.filter((candidate) => candidate.transferId !== transfer.transferId);
    }
  }
}

function isTransferTerminal(status) {
  return ['COMPLETED', 'FAILED', 'COMPENSATED'].includes(status);
}

async function runWorker(config, deadline) {
  while (Date.now() < deadline) {
    const operation = weightedPick(config.operationWeights);

    switch (operation) {
      case 'create':
        await runCreateAccount(config);
        break;
      case 'deposit':
        await runDeposit(config);
        break;
      case 'withdraw':
        await runWithdrawal(config);
        break;
      case 'balance':
        await runBalanceRead(config);
        break;
      case 'history':
        await runHistoryRead(config);
        break;
      case 'transferInitiate':
        await runInitiateTransfer(config);
        break;
      case 'transferStatus':
        await runTransferStatusRead(config);
        break;
      default:
        await runBalanceRead(config);
        break;
    }
  }
}

async function seedAccounts(config) {
  console.log(`Seeding ${config.seedAccounts} accounts with opening balance ${config.initialDeposit} ${config.currency}...`);
  const queue = [];

  for (let i = 0; i < config.seedAccounts; i += 1) {
    const account = makeAccount(config, config.nextAccountSequence++);
    const task = createAccount(config, account, config.initialDeposit, 'seedCreateAccount');
    queue.push(task);

    if (queue.length >= config.seedConcurrency) {
      await Promise.all(queue.splice(0, queue.length));
    }
  }

  if (queue.length > 0) {
    await Promise.all(queue);
  }

  console.log(`Seeded accounts available for load: ${config.accounts.length}`);
}

async function waitForHealth(config) {
  console.log(`Checking service health at ${config.baseUrl}/health ...`);

  for (let attempt = 1; attempt <= config.healthRetries; attempt += 1) {
    const response = await httpRequest(config, 'health', '/health');
    if (response.ok) {
      console.log('Service is reachable. Starting load test.');
      return;
    }

    console.log(`Health check attempt ${attempt}/${config.healthRetries} failed: ${response.status} ${response.message}`);
    if (attempt < config.healthRetries) {
      await sleep(config.healthRetryDelayMs);
    }
  }

  throw new Error(`Service at ${config.baseUrl} is not healthy after ${config.healthRetries} attempts.`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const durationSeconds = readNumber(args, 'duration', 60);
  const config = {
    baseUrl: sanitizeBaseUrl(readString(args, 'base-url', 'http://localhost:8080/api')),
    currency: readString(args, 'currency', 'NGN'),
    workers: readNumber(args, 'workers', 20),
    seedAccounts: readNumber(args, 'accounts', 100),
    seedConcurrency: readNumber(args, 'seed-concurrency', 10),
    initialDeposit: readNumber(args, 'initial-deposit', 10000),
    minAmount: readNumber(args, 'min-amount', 100),
    maxAmount: readNumber(args, 'max-amount', 1500),
    historyLimit: readNumber(args, 'history-limit', 20),
    hotAccountRatio: readNumber(args, 'hot-account-ratio', 0.1),
    hotSelectionRate: readNumber(args, 'hot-selection-rate', 0.8),
    maxTransferAmount: readNumber(args, 'max-transfer-amount', readNumber(args, 'max-amount', 1500)),
    healthRetries: readNumber(args, 'health-retries', 10),
    healthRetryDelayMs: readNumber(args, 'health-retry-delay-ms', 1500),
    removeCompletedTransfersFromPool:
      readString(args, 'remove-completed-transfers-from-pool', 'false') === 'true',
    accountPrefix: `load-${Date.now()}`,
    nextAccountSequence: 1,
    nextTransferSequence: 1,
    accounts: [],
    transfers: [],
    metrics: new Metrics(),
    operationWeights: [
      { name: 'deposit', weight: readNumber(args, 'deposit-weight', 35) },
      { name: 'withdraw', weight: readNumber(args, 'withdraw-weight', 30) },
      { name: 'balance', weight: readNumber(args, 'balance-weight', 20) },
      { name: 'history', weight: readNumber(args, 'history-weight', 10) },
      { name: 'create', weight: readNumber(args, 'create-weight', 5) },
      { name: 'transferInitiate', weight: readNumber(args, 'transfer-initiate-weight', 0) },
      { name: 'transferStatus', weight: readNumber(args, 'transfer-status-weight', 0) },
    ],
  };

  await waitForHealth(config);
  await seedAccounts(config);

  const deadline = Date.now() + durationSeconds * 1000;
  console.log(`Running workload for ${durationSeconds}s with ${config.workers} workers...`);
  console.log(
    `Mix: deposit=${config.operationWeights[0].weight}, withdraw=${config.operationWeights[1].weight}, ` +
      `balance=${config.operationWeights[2].weight}, history=${config.operationWeights[3].weight}, ` +
      `create=${config.operationWeights[4].weight}, transferInitiate=${config.operationWeights[5].weight}, ` +
      `transferStatus=${config.operationWeights[6].weight}`,
  );
  console.log(
    `Hot account pressure: ${Math.round(config.hotSelectionRate * 100)}% of requests target the top ` +
      `${Math.round(config.hotAccountRatio * 100)}% of active accounts.`,
  );

  const workers = Array.from({ length: config.workers }, () => runWorker(config, deadline));
  await Promise.all(workers);

  config.metrics.printSummary(durationSeconds);
  console.log('');
  console.log('Notes:');
  console.log('- Reads come from projections, so balance/history may briefly lag behind accepted writes.');
  console.log('- Transfer status reads also hit eventually-consistent projections and can briefly lag after initiation.');
  console.log('- Repeated 400s usually mean insufficient funds or frozen/currency-invalid account requests.');
  console.log('- Repeated 500s with WrongExpectedVersion suggest write contention worth hardening.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
