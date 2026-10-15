const ApiError = require('../utils/ApiError');

const buckets = new Map();

function consume(id, { windowMs = 60_000, max = 30 } = {}) {
  const now = Date.now();
  let bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
  bucket.count += 1;
  buckets.set(id, bucket);
  if (buckets.size > 5000) for (const [bucketId, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketId);
  return bucket.count <= max;
}

function rateLimit({ windowMs = 60_000, max = 30, key = (req) => req.user?.id || req.ip } = {}) {
  return (req, _res, next) => {
    const id = `${key(req)}:${req.baseUrl}`;
    if (!consume(id, { windowMs, max })) return next(new ApiError(429, 'Too many requests. Please try again shortly.'));
    return next();
  };
}

rateLimit.consume = consume;
module.exports = rateLimit;
