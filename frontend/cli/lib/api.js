const OpenAI = require('openai');
const { getApiBaseUrl } = require('./config');

// Default timeout for requests (60 seconds)
const DEFAULT_TIMEOUT = 60000;

/**
 * Custom API Error class with additional context.
 */
class APIError extends Error {
  constructor(message, statusCode = null, responseBody = null) {
    super(message);
    this.name = 'APIError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

/**
 * OpenAI Client wrapper for KimiBuilt backend.
 */
class OpenAIClient {
  constructor() {
    this.baseURL = getApiBaseUrl();
    this.client = new OpenAI({
      baseURL: this.baseURL,
      apiKey: 'any-key', // KimiBuilt doesn't require auth, but OpenAI SDK needs a key
      timeout: DEFAULT_TIMEOUT,
    });
  }

  /**
   * Refresh the client with current config (in case URL changed).
   */
  refreshClient() {
    this.baseURL = getApiBaseUrl();
    this.client = new OpenAI({
      baseURL: this.baseURL,
      apiKey: 'any-key',
      timeout: DEFAULT_TIMEOUT,
    });
  }

  /**
   * Send a chat message with streaming support.
   * @param {string} message - Message to send
   * @param {string|null} sessionId - Optional session ID
   * @param {Function} onDelta - Callback for delta events
   * @param {Function} onDone - Callback for done event
   * @param {string|null} model - Optional model ID
   * @returns {Promise<Object>} Final response data
   */
  async chat(message, sessionId, onDelta, onDone, model = null) {
    this.refreshClient();
    
    const messages = [{ role: 'user', content: message }];
    const params = {
      model: model || 'gpt-4o',
      messages,
      stream: true,
    };
    
    // Add KimiBuilt extension if sessionId provided
    if (sessionId) {
      params.session_id = sessionId;
    }

    try {
      const stream = await this.client.chat.completions.create(params);
      
      let finalSessionId = sessionId;
      let finalResponseId = null;
      
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        if (delta && onDelta) {
          onDelta(delta);
        }
        
        // Extract session ID from response if provided
        if (chunk.session_id) {
          finalSessionId = chunk.session_id;
        }
        
        if (chunk.id) {
          finalResponseId = chunk.id;
        }
      }
      
      if (onDone) {
        onDone({ sessionId: finalSessionId, responseId: finalResponseId });
      }
      
      return { sessionId: finalSessionId, responseId: finalResponseId };
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Send a chat message without streaming.
   * @param {string} message - Message to send
   * @param {string|null} sessionId - Optional session ID
   * @param {string|null} model - Optional model ID
   * @returns {Promise<Object>} Response data
   */
  async chatNonStreaming(message, sessionId, model = null) {
    this.refreshClient();
    
    const messages = [{ role: 'user', content: message }];
    const params = {
      model: model || 'gpt-4o',
      messages,
      stream: false,
    };
    
    if (sessionId) {
      params.session_id = sessionId;
    }

    try {
      const response = await this.client.chat.completions.create(params);
      
      const content = response.choices[0]?.message?.content || '';
      
      return {
        message: content,
        content,
        sessionId: response.session_id || sessionId,
        responseId: response.id,
      };
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Send a canvas mode request.
   * @param {string} message - Message to send
   * @param {string|null} sessionId - Optional session ID
   * @param {string} canvasType - Canvas type (code, document, diagram)
   * @param {string} existingContent - Existing content to modify
   * @param {string|null} model - Optional model ID
   * @returns {Promise<Object>} Response data
   */
  async canvas(message, sessionId, canvasType = 'document', existingContent = '', model = null) {
    this.refreshClient();
    
    // Canvas is handled via chat with a system prompt for now
    // KimiBuilt backend can handle this via custom endpoint or through chat
    const systemPrompt = `You are in canvas mode. Generate ${canvasType} content. ${existingContent ? 'Modify the existing content provided.' : ''}`;
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: message },
    ];
    
    if (existingContent) {
      messages.push({ role: 'assistant', content: existingContent });
      messages.push({ role: 'user', content: 'Please modify the above content.' });
    }
    
    const params = {
      model: model || 'gpt-4o',
      messages,
      stream: false,
    };
    
    if (sessionId) {
      params.session_id = sessionId;
    }

    try {
      const response = await this.client.chat.completions.create(params);
      
      return {
        content: response.choices[0]?.message?.content || '',
        canvasType,
        metadata: { model: response.model },
        suggestions: [],
        sessionId: response.session_id || sessionId,
      };
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Send a notation mode request.
   * @param {string} notation - Notation to process
   * @param {string|null} sessionId - Optional session ID
   * @param {string} helperMode - Helper mode (expand, explain, validate)
   * @param {string} context - Additional context
   * @param {string|null} model - Optional model ID
   * @returns {Promise<Object>} Response data
   */
  async notation(notationText, sessionId, helperMode = 'expand', context = '', model = null) {
    this.refreshClient();
    
    const systemPrompt = `You are in notation mode. Mode: ${helperMode}. ${context ? `Context: ${context}` : ''}`;
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: notationText },
    ];
    
    const params = {
      model: model || 'gpt-4o',
      messages,
      stream: false,
    };
    
    if (sessionId) {
      params.session_id = sessionId;
    }

    try {
      const response = await this.client.chat.completions.create(params);
      
      return {
        result: response.choices[0]?.message?.content || '',
        helperMode,
        annotations: [],
        suggestions: [],
        sessionId: response.session_id || sessionId,
      };
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Create a new session using custom endpoint.
   * @param {Object} metadata - Session metadata
   * @returns {Promise<Object>} Session data
   */
  async createSession(metadata = {}) {
    // Sessions are managed via custom KimiBuilt endpoints
    // Fall back to HTTP request for session management
    return this._legacyRequest('/api/sessions', { method: 'POST', body: { metadata } });
  }

  /**
   * List all sessions.
   * @returns {Promise<Object>} Sessions list
   */
  async listSessions() {
    return this._legacyRequest('/api/sessions', { method: 'GET' });
  }

  /**
   * Get a specific session by ID.
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Session data
   */
  async getSession(sessionId) {
    return this._legacyRequest(`/api/sessions/${sessionId}`, { method: 'GET' });
  }

  /**
   * Delete a session.
   * @param {string} sessionId - Session ID to delete
   * @returns {Promise<boolean>} Success status
   */
  async deleteSession(sessionId) {
    try {
      await this._legacyRequest(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if the API is accessible.
   * @returns {Promise<boolean>} True if API is reachable
   */
  async healthCheck() {
    try {
      this.refreshClient();
      // Use models.list as a health check
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get available chat models from the API.
   * @returns {Promise<Array>} Array of model objects
   */
  async getModels() {
    this.refreshClient();
    
    try {
      const response = await this.client.models.list();
      return response.data || [];
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Get available image generation models from the API.
   * @returns {Promise<Array>} Array of image model objects
   */
  async getImageModels() {
    // Fall back to legacy endpoint for image models
    try {
      const response = await this._legacyRequest('/api/images/models', { method: 'GET', timeout: 10000 });
      return response.models || [];
    } catch (err) {
      throw new APIError(`Failed to fetch image models: ${err.message}`, err.statusCode);
    }
  }

  /**
   * Generate an image using the API.
   * @param {string} prompt - Image generation prompt
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Response data with image URLs
   */
  async generateImage(prompt, options = {}) {
    this.refreshClient();
    
    const { model, size, quality, style, n, sessionId } = options;
    
    const params = {
      model: model || 'dall-e-3',
      prompt,
      n: n || 1,
      size: size || '1024x1024',
    };
    
    if (quality) params.quality = quality;
    if (style) params.style = style;
    if (sessionId) params.session_id = sessionId;

    try {
      const response = await this.client.images.generate(params);
      
      return {
        data: response.data || [],
        model: response.model || model || 'dall-e-3',
        size: size || '1024x1024',
        quality: quality || 'standard',
        style: style || 'vivid',
        sessionId: response.session_id || sessionId,
      };
    } catch (err) {
      throw this._handleError(err);
    }
  }

  /**
   * Handle errors from OpenAI SDK.
   * @private
   */
  _handleError(err) {
    if (err.status) {
      const statusCode = err.status;
      let message = err.message || 'Unknown error';
      
      if (statusCode === 404) {
        message = 'API endpoint not found. Please check that the server is running and the API URL is correct.';
      } else if (statusCode === 401) {
        message = 'Authentication failed. Please check your API credentials.';
      } else if (statusCode === 429) {
        message = 'Rate limit exceeded. Please wait a moment before trying again.';
      } else if (statusCode >= 500) {
        message = 'Server error. The AI backend may be experiencing issues. Please try again later.';
      }
      
      return new APIError(message, statusCode, err.error);
    }
    
    if (err.code === 'ECONNREFUSED') {
      return new APIError(`Connection refused. Please ensure the KimiBuilt server is running at ${this.baseURL}`);
    }
    
    if (err.code === 'ENOTFOUND') {
      return new APIError(`Host not found. Please check your API URL configuration: ${this.baseURL}`);
    }
    
    if (err.code === 'ETIMEDOUT') {
      return new APIError('Connection timed out. The server may be slow or unreachable.');
    }
    
    return new APIError(err.message || 'Request failed');
  }

  /**
   * Legacy HTTP request for non-OpenAI endpoints.
   * @private
   */
  async _legacyRequest(path, options = {}) {
    const http = require('http');
    const https = require('https');
    
    return new Promise((resolve, reject) => {
      const baseUrlStr = this.baseURL.replace('/v1', ''); // Remove /v1 for legacy endpoints
      let baseUrl;
      
      try {
        baseUrl = new URL(baseUrlStr);
      } catch (err) {
        reject(new APIError(`Invalid API URL: ${baseUrlStr}`));
        return;
      }
      
      const method = options.method || 'GET';
      const postData = options.body ? JSON.stringify(options.body) : null;
      const timeout = options.timeout || DEFAULT_TIMEOUT;
      
      const requestOptions = {
        hostname: baseUrl.hostname,
        port: baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80),
        path: path,
        method: method,
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'KimiBuilt-CLI/2.1.0',
          ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
        },
      };
      
      const httpModule = baseUrlStr.startsWith('https:') ? https : http;
      
      const req = httpModule.request(requestOptions, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed);
            } else {
              reject(new APIError(`HTTP ${res.statusCode}: ${data}`, res.statusCode));
            }
          } catch (err) {
            reject(new APIError(`Failed to parse response: ${err.message}`));
          }
        });
      });
      
      req.on('error', (err) => {
        reject(new APIError(`Request failed: ${err.message}`));
      });
      
      req.on('timeout', () => {
        req.destroy();
        reject(new APIError('Request timed out'));
      });
      
      if (postData) {
        req.write(postData);
      }
      
      req.end();
    });
  }
}

// Create singleton instance
const client = new OpenAIClient();

// Export functions that use the OpenAI client
module.exports = {
  APIError,
  request: (path, options) => client._legacyRequest(path, options),
  chat: (message, sessionId, onDelta, onDone, model) => client.chat(message, sessionId, onDelta, onDone, model),
  chatNonStreaming: (message, sessionId, model) => client.chatNonStreaming(message, sessionId, model),
  canvas: (message, sessionId, canvasType, existingContent, model) => 
    client.canvas(message, sessionId, canvasType, existingContent, model),
  notation: (notationText, sessionId, helperMode, context, model) => 
    client.notation(notationText, sessionId, helperMode, context, model),
  createSession: (metadata) => client.createSession(metadata),
  listSessions: () => client.listSessions(),
  getSession: (sessionId) => client.getSession(sessionId),
  deleteSession: (sessionId) => client.deleteSession(sessionId),
  healthCheck: () => client.healthCheck(),
  getModels: () => client.getModels(),
  getImageModels: () => client.getImageModels(),
  generateImage: (prompt, options) => client.generateImage(prompt, options),
  parseSSE: (chunk) => [], // Deprecated: OpenAI SDK handles streaming internally
  OpenAIClient,
};
