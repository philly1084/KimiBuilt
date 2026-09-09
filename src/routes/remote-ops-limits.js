'use strict';
// Cheap admission control before session/transcript reads. Bounded process-local buckets;
// the per-session gateway polling budget is additionally persisted under a database lock.
const buckets = new Map();
function admit(owner, scope, { max = 60, windowMs = 60000, now = Date.now() } = {}) {
  const key = `${scope}:${owner}`;
  if (buckets.size >= 10000) for (const [k, v] of buckets) if (v.until <= now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || b.until <= now) {
    if (buckets.size >= 10000 && !b) return 60;
    b = { count: 0, until: now + windowMs }; buckets.set(key, b);
  }
  if (b.count >= max) return Math.max(1, Math.ceil((b.until - now) / 1000));
  b.count++; return 0;
}
function limited(res, seconds, message = 'Request limit reached. Respect Retry-After.') {
  res.set('Retry-After', String(seconds));
  return res.status(429).json({ success: false, error: message, code: 'rate_limited', retryAfterSeconds: seconds });
}
module.exports = { admit, limited };
