const crypto = require('crypto');

function idempotencyKeyGenerator() {
  console.log(crypto.randomUUID());
}

function transactionIdGenerator(prefix = 'TXN') {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(5).toString('base64url').toUpperCase();
  console.log(`${prefix}-${date}-${randomPart}`); 
}

idempotencyKeyGenerator();
transactionIdGenerator();