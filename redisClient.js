// redisClient.js (CommonJS)
require('dotenv').config();
const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const client = createClient({ url: redisUrl });

client.on('error', (err) => {
  console.error('Redis Client Error', err);
});

// connect immediately (fire-and-forget connect wrapped for safety)
(async () => {
  try {
    await client.connect();
    console.log('✅ Connected to Redis at', redisUrl);
  } catch (err) {
    console.error('⚠️ Redis connection failed, continuing without cache:', err.message);
    // don't throw — app will continue and middleware will tolerate missing Redis.
  }
})();

module.exports = client;
