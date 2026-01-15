/**
 * GHL Error Handler
 * Enhanced error handling for GHL API and MCP interactions
 */

/**
 * GHL-specific error codes and their handling
 */
const GHL_ERROR_CODES = {
    400: { type: 'BAD_REQUEST', retryable: false, message: 'Bad request - validate payload schema' },
    401: { type: 'AUTH_ERROR', retryable: false, message: 'Authentication failed - check API key' },
    403: { type: 'SCOPE_ERROR', retryable: false, message: 'Insufficient permissions - check scopes' },
    404: { type: 'NOT_FOUND', retryable: false, message: 'Resource not found' },
    422: { type: 'VALIDATION_ERROR', retryable: false, message: 'Invalid request data - review field values' },
    429: { type: 'RATE_LIMIT', retryable: true, message: 'Rate limit exceeded' },
    500: { type: 'GHL_ERROR', retryable: true, message: 'GHL internal error' },
    502: { type: 'BAD_GATEWAY', retryable: true, message: 'GHL bad gateway' },
    503: { type: 'SERVICE_UNAVAILABLE', retryable: true, message: 'GHL service unavailable' },
    504: { type: 'GATEWAY_TIMEOUT', retryable: true, message: 'GHL gateway timeout' }
};

/**
 * Custom GHL Error class
 */
class GHLError extends Error {
    constructor(originalError, context = {}) {
        const status = originalError.response?.status || 500;
        const errorInfo = GHL_ERROR_CODES[status] || GHL_ERROR_CODES[500];

        super(errorInfo.message);
        this.name = 'GHLError';
        this.type = errorInfo.type;
        this.status = status;
        this.retryable = errorInfo.retryable;
        this.context = context;
        this.originalError = originalError;
        this.ghlResponse = originalError.response?.data;
        this.timestamp = new Date().toISOString();
    }

    toJSON() {
        return {
            name: this.name,
            type: this.type,
            status: this.status,
            message: this.message,
            retryable: this.retryable,
            context: this.context,
            ghlResponse: this.ghlResponse,
            timestamp: this.timestamp
        };
    }
}

/**
 * Retry wrapper with exponential backoff
 * @param {Function} operation - Async function to execute
 * @param {Object} options - Retry options
 * @returns {Promise<any>} Result of the operation
 */
async function withRetry(operation, options = {}) {
    const {
        maxRetries = 3,
        baseDelay = 1000,
        maxDelay = 30000,
        retryableErrors = ['RATE_LIMIT', 'GHL_ERROR', 'SERVICE_UNAVAILABLE', 'BAD_GATEWAY', 'GATEWAY_TIMEOUT'],
        onRetry = null
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error instanceof GHLError ? error : new GHLError(error);

            // Don't retry non-retryable errors
            if (!lastError.retryable || !retryableErrors.includes(lastError.type)) {
                throw lastError;
            }

            // Don't retry after max attempts
            if (attempt >= maxRetries) {
                throw lastError;
            }

            // Calculate delay with exponential backoff + jitter
            const jitter = Math.random() * 500;
            const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);

            console.warn(`Retry attempt ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms: ${lastError.type}`);

            if (onRetry) {
                onRetry(attempt + 1, lastError, delay);
            }

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}

/**
 * MCP-specific error handler with fallback support
 * @param {Error} error - The MCP error
 * @param {Function} fallbackOperation - Fallback function to execute
 * @returns {Promise<any>} Result from fallback operation
 */
async function handleMCPError(error, fallbackOperation) {
    const mcpErrors = [
        'MCP_TRANSPORT_ERROR',
        'MCP_TIMEOUT',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND'
    ];

    const shouldFallback =
        error.code && mcpErrors.includes(error.code) ||
        error.message?.includes('MCP') ||
        error.message?.includes('timeout') ||
        error.response?.status >= 500;

    if (shouldFallback && fallbackOperation) {
        console.warn('MCP error detected, falling back to direct API:', error.message);
        return fallbackOperation();
    }

    throw error;
}

/**
 * Wrap an error for consistent logging
 * @param {Error} error - The original error
 * @param {string} operation - Name of the operation that failed
 * @param {Object} context - Additional context
 * @returns {GHLError} Wrapped error
 */
function wrapError(error, operation, context = {}) {
    if (error instanceof GHLError) {
        error.context = { ...error.context, operation, ...context };
        return error;
    }
    return new GHLError(error, { operation, ...context });
}

module.exports = {
    GHLError,
    GHL_ERROR_CODES,
    withRetry,
    handleMCPError,
    wrapError
};
