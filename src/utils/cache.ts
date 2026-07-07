const localRateLimit = new Map<string, { count: number, reset: number }>();

export const cacheUtils = {
  /**
   * 生成规范的缓存 URL
   */
  generateCacheUrl(key: string): string {
    return `https://redsky.local/cache/${encodeURIComponent(key)}`;
  },

  async get<T>(cache: Cache, key: string): Promise<T | null> {
    const url = this.generateCacheUrl(key);
    const response = await cache.match(url);
    if (!response) return null;
    return response.json();
  },

  async set(cache: Cache, key: string, data: any, ttlSeconds: number): Promise<void> {
    const url = this.generateCacheUrl(key);
    const response = new Response(JSON.stringify(data), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${ttlSeconds}`
      }
    });
    return cache.put(url, response);
  },

  async delete(cache: Cache, key: string): Promise<boolean> {
    const url = this.generateCacheUrl(key);
    return cache.delete(url);
  },

  /**
   * 速率限制检查 (滑动窗口)
   * Menggunakan in-memory Map (Isolate-local) untuk menghindari race condition Cache API
   */
  async isRateLimited(cache: Cache, key: string, limit: number, windowSec: number): Promise<boolean> {
    const now = Math.floor(Date.now() / 1000);
    
    // Sesekali bersihkan map dari key yang sudah kedaluwarsa untuk mencegah memory leak
    if (Math.random() < 0.05) {
      for (const [k, v] of localRateLimit.entries()) {
        if (now > v.reset) localRateLimit.delete(k);
      }
    }

    let local = localRateLimit.get(key);
    if (local && now > local.reset) {
      localRateLimit.delete(key);
      local = undefined;
    }

    if (!local) {
      localRateLimit.set(key, { count: 1, reset: now + windowSec });
      return false;
    }

    if (local.count >= limit) return true;

    local.count += 1;
    return false;
  }
};
