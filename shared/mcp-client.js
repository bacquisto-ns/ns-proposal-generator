/**
 * GHL MCP Client Wrapper
 * Provides standardized access to GHL's official MCP server
 */
const axios = require('axios');

const MCP_ENDPOINT = process.env.GHL_MCP_ENDPOINT || 'https://services.leadconnectorhq.com/mcp/';

class GHLMCPClient {
    constructor(apiKey, locationId) {
        if (!apiKey || !apiKey.trim()) {
            throw new Error('API key is required for GHLMCPClient');
        }
        if (!locationId || !locationId.trim()) {
            throw new Error('Location ID is required for GHLMCPClient');
        }

        this.apiKey = apiKey.trim();
        this.locationId = locationId.trim();
        this.client = axios.create({
            baseURL: MCP_ENDPOINT,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'locationId': this.locationId,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        this.requestId = 0;
    }

    /**
     * Generate unique request ID for JSON-RPC calls
     */
    _nextRequestId() {
        return ++this.requestId;
    }

    /**
     * Execute an MCP tool call
     * @param {string} toolName - MCP tool identifier (e.g., 'contacts_upsert-contact')
     * @param {object} params - Tool parameters
     * @returns {Promise<object>} Tool execution result
     */
    async callTool(toolName, params) {
        const payload = {
            jsonrpc: '2.0',
            id: this._nextRequestId(),
            method: 'tools/call',
            params: {
                name: toolName,
                arguments: params
            }
        };

        try {
            const response = await this.client.post('', payload);

            if (response.data.error) {
                const error = new Error(response.data.error.message || 'MCP tool call failed');
                error.code = response.data.error.code;
                error.mcpError = true;
                throw error;
            }

            return response.data.result;
        } catch (error) {
            if (error.mcpError) throw error;

            // Wrap axios errors
            const wrappedError = new Error(`MCP call to ${toolName} failed: ${error.message}`);
            wrappedError.originalError = error;
            wrappedError.toolName = toolName;
            wrappedError.response = error.response;
            throw wrappedError;
        }
    }

    /**
     * List available MCP tools
     * @returns {Promise<Array>} Array of available tools
     */
    async listTools() {
        const payload = {
            jsonrpc: '2.0',
            id: this._nextRequestId(),
            method: 'tools/list'
        };

        try {
            const response = await this.client.post('', payload);

            if (response.data.error) {
                const error = new Error(response.data.error.message || 'Failed to list MCP tools');
                error.code = response.data.error.code;
                throw error;
            }

            return response.data.result?.tools || [];
        } catch (error) {
            console.warn('Failed to list MCP tools:', error.message);
            return [];
        }
    }

    /**
     * Check if a specific tool is available
     * @param {string} toolName - Tool name to check
     * @returns {Promise<boolean>} Whether the tool is available
     */
    async hasTools(toolName) {
        const tools = await this.listTools();
        return tools.some(t => t.name === toolName);
    }
}

module.exports = { GHLMCPClient, MCP_ENDPOINT };
