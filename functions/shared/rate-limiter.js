/**
 * Rate Limiter for GHL API
 * Implements token bucket algorithm with per-category limits
 */

/**
 * GHL API rate limits by category
 * These are conservative estimates - adjust based on actual GHL documentation
 */
const RATE_LIMITS = {
    contacts: { requests: 100, window: 60000 },      // 100 requests per minute
    opportunities: { requests: 100, window: 60000 }, // 100 requests per minute
    conversations: { requests: 60, window: 60000 },  // 60 requests per minute
    users: { requests: 100, window: 60000 },         // 100 requests per minute
    media: { requests: 30, window: 60000 },          // 30 requests per minute (file uploads)
    default: { requests: 100, window: 60000 }        // Default fallback
};

/**
 * Rate Limiter class implementing sliding window algorithm
 */
class RateLimiter {
    constructor() {
        this.buckets = new Map();
    }

    /**
     * Get or create a bucket for a category
     * @param {string} category - Rate limit category
     * @returns {Object} Bucket object
     */
    _getBucket(category) {
        if (!this.buckets.has(category)) {
            this.buckets.set(category, { requests: [] });
        }
        return this.buckets.get(category);
    }

    /**
     * Clean expired requests from bucket
     * @param {Array} requests - Array of request timestamps
     * @param {number} window - Time window in ms
     * @returns {Array} Cleaned requests array
     */
    _cleanExpired(requests, window) {
        const now = Date.now();
        return requests.filter(timestamp => now - timestamp < window);
    }

    /**
     * Acquire a rate limit token (blocks until available)
     * @param {string} category - Rate limit category
     * @returns {Promise<boolean>} True when token acquired
     */
    async acquire(category = 'default') {
        const limit = RATE_LIMITS[category] || RATE_LIMITS.default;
        const bucket = this._getBucket(category);

        // Clean expired requests
        bucket.requests = this._cleanExpired(bucket.requests, limit.window);

        // Check if we're at the limit
        if (bucket.requests.length >= limit.requests) {
            const oldestRequest = bucket.requests[0];
            const waitTime = limit.window - (Date.now() - oldestRequest);

            if (waitTime > 0) {
                console.warn(`Rate limit for ${category}: waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.acquire(category);
            }
        }

        // Record this request
        bucket.requests.push(Date.now());
        return true;
    }

    /**
     * Check if a request can be made without waiting
     * @param {string} category - Rate limit category
     * @returns {boolean} True if request can proceed immediately
     */
    canProceed(category = 'default') {
        const limit = RATE_LIMITS[category] || RATE_LIMITS.default;
        const bucket = this._getBucket(category);

        bucket.requests = this._cleanExpired(bucket.requests, limit.window);
        return bucket.requests.length < limit.requests;
    }

    /**
     * Get current usage stats for a category
     * @param {string} category - Rate limit category
     * @returns {Object} Usage statistics
     */
    getStats(category = 'default') {
        const limit = RATE_LIMITS[category] || RATE_LIMITS.default;
        const bucket = this._getBucket(category);

        bucket.requests = this._cleanExpired(bucket.requests, limit.window);

        return {
            category,
            current: bucket.requests.length,
            limit: limit.requests,
            window: limit.window,
            remaining: limit.requests - bucket.requests.length,
            resetIn: bucket.requests.length > 0
                ? limit.window - (Date.now() - bucket.requests[0])
                : 0
        };
    }

    /**
     * Reset all rate limit buckets
     */
    reset() {
        this.buckets.clear();
    }

    /**
     * Reset a specific category's bucket
     * @param {string} category - Rate limit category
     */
    resetCategory(category) {
        this.buckets.delete(category);
    }
}

// Singleton instance for shared rate limiting
const rateLimiter = new RateLimiter();

module.exports = {
    RateLimiter,
    RATE_LIMITS,
    rateLimiter
};
