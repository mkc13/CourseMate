// cacheMiddleware.js (CommonJS)
const crypto = require('crypto');
const redisClient = require('./redisClient');

/**
 * Create a deterministic short cache key from a prefix and the request payload.
 * We hash the JSON body to avoid very long keys and to be safe for special chars.
 */
function makeCacheKey(prefix, payload) {
  const hash = crypto.createHash('sha256').update(String(payload)).digest('hex');
  return `${prefix}:${hash}`;
}

/**
 * cacheResponse(prefix, ttlSeconds)
 * Checks Redis for key; if present returns it and ends response.
 * Otherwise sets res.locals.cacheKey and res.locals.cacheTTL and calls next().
 */
function cacheResponse(prefix, ttlSeconds = 3600) {
  return async (req, res, next) => {
    try {
      const payload = JSON.stringify(req.body || req.query || req.params || '');
      const key = makeCacheKey(prefix, payload);

      // If redis is not connected, client.get will throw; handle defensively.
      if (!redisClient || typeof redisClient.get !== 'function') {
        res.locals.cacheKey = null;
        return next();
      }

      const cached = await redisClient.get(key);
      if (cached) {
        // cached is stringified JSON of the payload we stored
        const parsed = JSON.parse(cached);
        // send the cached object exactly how route would send it
        return res.json(parsed);
      }

      // Not found — let the route handler proceed and save key/ttl there.
      res.locals.cacheKey = key;
      res.locals.cacheTTL = ttlSeconds;
      return next();
    } catch (err) {
      console.error('Cache middleware error — continuing without cache:', err.message);
      // Do not stop the request on cache error; continue to generate fresh response.
      return next();
    }
  };
}

module.exports = { cacheResponse, makeCacheKey };
