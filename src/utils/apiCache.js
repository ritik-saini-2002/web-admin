// ═══════════════════════════════════════════════════════════════════════════
// API Cache & Request Deduplication — Heavy-duty architecture for 10k+ users
// ═══════════════════════════════════════════════════════════════════════════

const cache = new Map();
const inflight = new Map();
const DEFAULT_TTL = 30_000; // 30 seconds

/**
 * Create a cache key from method + url + body
 */
function makeCacheKey(method, url, body) {
  return `${method}:${url}:${body ? JSON.stringify(body) : ''}`;
}

/**
 * Cached fetch wrapper with request deduplication.
 * - If the same request is in-flight, reuse the promise (dedup)
 * - If a cached result exists and is fresh, return it immediately
 * - Otherwise, make a new request and cache the result
 *
 * @param {Function} fetchFn - The actual fetch function to call (must return a promise)
 * @param {string} cacheKey - Unique key for this request
 * @param {number} ttl - Cache TTL in ms (0 = no cache, just dedup)
 * @returns {Promise} The response
 */
export async function cachedFetch(fetchFn, cacheKey, ttl = DEFAULT_TTL) {
  // 1. Check cache
  if (ttl > 0) {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data;
    }
  }

  // 2. Check in-flight (dedup)
  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey);
  }

  // 3. Make the request
  const promise = fetchFn()
    .then(result => {
      inflight.delete(cacheKey);
      if (ttl > 0) {
        cache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
      return result;
    })
    .catch(err => {
      inflight.delete(cacheKey);
      throw err;
    });

  inflight.set(cacheKey, promise);
  return promise;
}

/**
 * Invalidate a specific cache entry or all entries matching a prefix
 */
export function invalidateCache(keyOrPrefix) {
  if (!keyOrPrefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key === keyOrPrefix || key.startsWith(keyOrPrefix)) {
      cache.delete(key);
    }
  }
}

/**
 * Invalidate all cache entries for a specific collection
 */
export function invalidateCollection(collection) {
  for (const key of cache.keys()) {
    if (key.includes(`/collections/${collection}/`)) {
      cache.delete(key);
    }
  }
}

/**
 * Get cache stats for debugging
 */
export function getCacheStats() {
  return {
    cached: cache.size,
    inflight: inflight.size,
    keys: [...cache.keys()],
  };
}

export { makeCacheKey };
