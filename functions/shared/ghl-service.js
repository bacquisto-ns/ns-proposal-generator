/**
 * GHL Service - Unified service layer for GoHighLevel API
 * Implements hybrid approach: MCP when available, fallback to direct REST API
 */
const axios = require('axios');
const { GHLMCPClient } = require('./mcp-client');
const { getGHLHeaders } = require('./utils');
const { GHLError, withRetry, handleMCPError, wrapError } = require('./error-handler');
const { rateLimiter } = require('./rate-limiter');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

class GHLService {
    /**
     * Create a new GHL Service instance
     * @param {string} apiKey - GHL API key (PIT or OAuth token)
     * @param {string} locationId - GHL Location ID
     * @param {Object} options - Configuration options
     */
    constructor(apiKey, locationId, options = {}) {
        if (!apiKey || !apiKey.trim()) {
            throw new Error('API key is required for GHLService');
        }
        if (!locationId || !locationId.trim()) {
            throw new Error('Location ID is required for GHLService');
        }

        this.apiKey = apiKey.trim();
        this.locationId = locationId.trim();
        this.options = {
            useMCP: options.useMCP !== false, // Enable MCP by default
            useRateLimiting: options.useRateLimiting !== false, // Enable rate limiting by default
            retryOnError: options.retryOnError !== false, // Enable retry by default
            maxRetries: options.maxRetries || 3,
            ...options
        };

        // Initialize MCP client if enabled
        if (this.options.useMCP) {
            try {
                this.mcpClient = new GHLMCPClient(this.apiKey, this.locationId);
            } catch (error) {
                console.warn('Failed to initialize MCP client:', error.message);
                this.mcpClient = null;
            }
        }

        // Initialize direct API client
        this.directClient = axios.create({
            baseURL: GHL_BASE_URL,
            headers: getGHLHeaders(this.apiKey),
            timeout: 30000
        });

        // Cache for available MCP tools
        this.mcpTools = null;
        this.mcpToolsLoaded = false;
    }

    /**
     * Initialize the service (loads available MCP tools)
     * Call this before using MCP features
     */
    async initialize() {
        if (this.mcpClient && !this.mcpToolsLoaded) {
            try {
                this.mcpTools = await this.mcpClient.listTools();
                this.mcpToolsLoaded = true;
                console.log(`GHLService initialized with ${this.mcpTools.length} MCP tools`);
            } catch (error) {
                console.warn('MCP tools unavailable, using direct API only:', error.message);
                this.mcpTools = [];
                this.mcpToolsLoaded = true;
            }
        }
    }

    /**
     * Check if a specific MCP tool is available
     * @param {string} toolName - Tool name to check
     * @returns {boolean} Whether the tool is available
     */
    hasMCPTool(toolName) {
        return this.mcpTools?.some(t => t.name === toolName) ?? false;
    }

    /**
     * Execute operation with rate limiting and retry
     * @param {string} category - Rate limit category
     * @param {Function} operation - Async operation to execute
     * @returns {Promise<any>} Operation result
     */
    async _executeWithProtection(category, operation) {
        // Apply rate limiting if enabled
        if (this.options.useRateLimiting) {
            await rateLimiter.acquire(category);
        }

        // Apply retry if enabled
        if (this.options.retryOnError) {
            return withRetry(operation, { maxRetries: this.options.maxRetries });
        }

        return operation();
    }

    // ==================== CONTACT OPERATIONS ====================

    /**
     * Search contacts by query
     * @param {string} query - Search query
     * @param {Object} options - Search options
     * @returns {Promise<Object>} Search results
     */
    async searchContacts(query, options = {}) {
        const { limit = 50 } = options;

        return this._executeWithProtection('contacts', async () => {
            // Try MCP first
            if (this.hasMCPTool('contacts_get-contacts')) {
                try {
                    return await this.mcpClient.callTool('contacts_get-contacts', {
                        locationId: this.locationId,
                        query: query,
                        limit: limit
                    });
                } catch (error) {
                    return handleMCPError(error, () => this._searchContactsDirect(query, limit));
                }
            }

            // Fallback to direct API
            return this._searchContactsDirect(query, limit);
        });
    }

    async _searchContactsDirect(query, limit) {
        const response = await this.directClient.get('/contacts/', {
            params: {
                locationId: this.locationId,
                query: query,
                limit: limit
            }
        });
        return response.data;
    }

    /**
     * Upsert a contact (create or update)
     * @param {Object} contactData - Contact data
     * @returns {Promise<Object>} Upsert result with contact info
     */
    async upsertContact(contactData) {
        const payload = {
            ...contactData,
            locationId: this.locationId
        };

        return this._executeWithProtection('contacts', async () => {
            // Try MCP first
            if (this.hasMCPTool('contacts_upsert-contact')) {
                try {
                    return await this.mcpClient.callTool('contacts_upsert-contact', payload);
                } catch (error) {
                    return handleMCPError(error, () => this._upsertContactDirect(payload));
                }
            }

            // Fallback to direct API
            return this._upsertContactDirect(payload);
        });
    }

    async _upsertContactDirect(payload) {
        const response = await this.directClient.post('/contacts/upsert', payload);
        return response.data;
    }

    /**
     * Get a single contact by ID
     * @param {string} contactId - Contact ID
     * @returns {Promise<Object>} Contact data
     */
    async getContact(contactId) {
        return this._executeWithProtection('contacts', async () => {
            if (this.hasMCPTool('contacts_get-contact')) {
                try {
                    return await this.mcpClient.callTool('contacts_get-contact', {
                        contactId: contactId
                    });
                } catch (error) {
                    return handleMCPError(error, () => this._getContactDirect(contactId));
                }
            }
            return this._getContactDirect(contactId);
        });
    }

    async _getContactDirect(contactId) {
        const response = await this.directClient.get(`/contacts/${contactId}`);
        return response.data;
    }

    /**
     * Add a note to a contact
     * @param {string} contactId - Contact ID
     * @param {string} body - Note content
     * @returns {Promise<Object>} Note creation result
     */
    async addContactNote(contactId, body) {
        return this._executeWithProtection('contacts', async () => {
            const response = await this.directClient.post(`/contacts/${contactId}/notes`, {
                body: body
            });
            return response.data;
        });
    }

    // ==================== OPPORTUNITY OPERATIONS ====================

    /**
     * Create a new opportunity
     * Note: MCP may not support opportunity creation, using direct API
     * @param {Object} opportunityData - Opportunity data
     * @returns {Promise<Object>} Created opportunity
     */
    async createOpportunity(opportunityData) {
        const payload = {
            ...opportunityData,
            locationId: this.locationId
        };

        return this._executeWithProtection('opportunities', async () => {
            // GHL MCP typically doesn't support create, use direct API
            const response = await this.directClient.post('/opportunities/', payload);
            return response.data;
        });
    }

    /**
     * Update an existing opportunity
     * @param {string} opportunityId - Opportunity ID
     * @param {Object} updateData - Fields to update
     * @returns {Promise<Object>} Updated opportunity
     */
    async updateOpportunity(opportunityId, updateData) {
        return this._executeWithProtection('opportunities', async () => {
            if (this.hasMCPTool('opportunities_update-opportunity')) {
                try {
                    return await this.mcpClient.callTool('opportunities_update-opportunity', {
                        id: opportunityId,
                        ...updateData
                    });
                } catch (error) {
                    return handleMCPError(error, () => this._updateOpportunityDirect(opportunityId, updateData));
                }
            }
            return this._updateOpportunityDirect(opportunityId, updateData);
        });
    }

    async _updateOpportunityDirect(opportunityId, updateData) {
        const response = await this.directClient.put(`/opportunities/${opportunityId}`, updateData);
        return response.data;
    }

    /**
     * Add a note to an opportunity
     * @param {string} opportunityId - Opportunity ID
     * @param {string} body - Note content
     * @returns {Promise<Object>} Note creation result
     */
    async addOpportunityNote(opportunityId, body) {
        return this._executeWithProtection('opportunities', async () => {
            const response = await this.directClient.post(`/opportunities/${opportunityId}/notes`, {
                body: body
            });
            return response.data;
        });
    }

    // ==================== USER OPERATIONS ====================

    /**
     * Get users for a location
     * @returns {Promise<Object>} Users list
     */
    async getUsers() {
        return this._executeWithProtection('users', async () => {
            const response = await this.directClient.get('/users/', {
                params: { locationId: this.locationId }
            });
            return response.data;
        });
    }

    // ==================== CONVERSATION/MESSAGING OPERATIONS ====================

    /**
     * Send a message (email, SMS, etc.)
     * @param {Object} messageData - Message data
     * @returns {Promise<Object>} Send result
     */
    async sendMessage(messageData) {
        return this._executeWithProtection('conversations', async () => {
            if (this.hasMCPTool('conversations_send-a-new-message')) {
                try {
                    return await this.mcpClient.callTool('conversations_send-a-new-message', messageData);
                } catch (error) {
                    return handleMCPError(error, () => this._sendMessageDirect(messageData));
                }
            }
            return this._sendMessageDirect(messageData);
        });
    }

    async _sendMessageDirect(messageData) {
        const response = await this.directClient.post('/conversations/messages', messageData);
        return response.data;
    }

    // ==================== MEDIA OPERATIONS ====================

    /**
     * Upload a file to GHL
     * @param {FormData} formData - Form data with file
     * @returns {Promise<Object>} Upload result with URL
     */
    async uploadFile(formData) {
        return this._executeWithProtection('media', async () => {
            const response = await this.directClient.post('/medias/upload-file', formData, {
                headers: {
                    ...getGHLHeaders(this.apiKey),
                    'Content-Type': 'multipart/form-data'
                }
            });
            return response.data;
        });
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Get rate limiter stats
     * @returns {Object} Stats for all categories
     */
    getRateLimitStats() {
        return {
            contacts: rateLimiter.getStats('contacts'),
            opportunities: rateLimiter.getStats('opportunities'),
            conversations: rateLimiter.getStats('conversations'),
            users: rateLimiter.getStats('users'),
            media: rateLimiter.getStats('media')
        };
    }

    /**
     * Get service status
     * @returns {Object} Service status info
     */
    getStatus() {
        return {
            mcpEnabled: this.options.useMCP,
            mcpAvailable: this.mcpClient !== null,
            mcpToolsLoaded: this.mcpToolsLoaded,
            mcpToolCount: this.mcpTools?.length || 0,
            rateLimitingEnabled: this.options.useRateLimiting,
            retryEnabled: this.options.retryOnError,
            locationId: this.locationId
        };
    }
}

module.exports = { GHLService, GHL_BASE_URL };
