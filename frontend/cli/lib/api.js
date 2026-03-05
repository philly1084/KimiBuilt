const http = require('http');
const https = require('https');
const { getApiBaseUrl } = require('./config');

// Default timeout for requests (30 seconds)
const DEFAULT_TIMEOUT = 30000;

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
 * Parse SSE data lines from a chunk.
 * @param {string} chunk - Raw data chunk
 * @returns {Array<Object>} Parsed SSE events
 */
function parseSSE(chunk) {
  const events = [];
  const lines = chunk.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('data: ')) {
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        events.push({ type: 'done' });
      } else {
        try {
          const parsed = JSON.parse(data);
          events.push(parsed);
        } catch {
          events.push({ type: 'raw', content: data });
        }
      }
    } else if (trimmed.startsWith('event: ')) {
      // Handle event type lines
      const eventType = trimmed.slice(7);
      events.push({ type: 'event', eventType });
    } else if (trimmed.startsWith('id: ')) {
      // Handle id lines
      events.push({ type: 'id', id: trimmed.slice(4) });
    }
  }
  
  return events;
}

/**
 * Get the appropriate HTTP/HTTPS module based on URL.
 * @param {string} url - URL to check
 * @returns {Object} http or https module
 */
function getHttpModule(url) {
  return url.startsWith('https:') ? https : http;
}

/**
 * Make an HTTP request to the API.
 * @param {string} path - API path
 * @param {Object} options - Request options
 * @returns {Promise<Object>} Response data
 */
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const baseUrlStr = getApiBaseUrl();
    let baseUrl;
    
    try {
      baseUrl = new URL(baseUrlStr);
    } catch (err) {
      reject(new APIError(`Invalid API URL: ${baseUrlStr}. Please check your configuration.`));
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
        'User-Agent': 'KimiBuilt-CLI/2.0.0',
        ...(postData && { 'Content-Length': Buffer.byteLength(postData) }),
        ...(options.headers || {}),
      },
    };
    
    const httpModule = getHttpModule(baseUrlStr);
    
    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      const sessionId = res.headers['x-session-id'];
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const parsed = data ? JSON.parse(data) : {};
            resolve({ ...parsed, sessionId: sessionId || parsed.sessionId });
          } else if (res.statusCode === 404) {
            reject(new APIError(
              'API endpoint not found. Please check that the server is running and the API URL is correct.',
              res.statusCode,
              data
            ));
          } else if (res.statusCode === 401) {
            reject(new APIError(
              'Authentication failed. Please check your API credentials.',
              res.statusCode,
              data
            ));
          } else if (res.statusCode === 429) {
            reject(new APIError(
              'Rate limit exceeded. Please wait a moment before trying again.',
              res.statusCode,
              data
            ));
          } else if (res.statusCode >= 500) {
            reject(new APIError(
              'Server error. The AI backend may be experiencing issues. Please try again later.',
              res.statusCode,
              data
            ));
          } else {
            reject(new APIError(
              `HTTP ${res.statusCode}: ${data || 'Unknown error'}`,
              res.statusCode,
              data
            ));
          }
        } catch (err) {
          reject(new APIError(`Failed to parse response: ${err.message}`));
        }
      });
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new APIError(
          `Connection refused. Please ensure the KimiBuilt server is running at ${baseUrlStr}`
        ));
      } else if (err.code === 'ENOTFOUND') {
        reject(new APIError(
          `Host not found. Please check your API URL configuration: ${baseUrlStr}`
        ));
      } else if (err.code === 'ETIMEDOUT') {
        reject(new APIError(
          'Connection timed out. The server may be slow or unreachable.'
        ));
      } else {
        reject(new APIError(`Request failed: ${err.message}`));
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new APIError(
        `Request timed out after ${timeout}ms. The server may be slow or the operation too complex.`
      ));
    });
    
    if (postData) {
      req.write(postData);
    }
    
    req.end();
  });
}

/**
 * Send a chat message with SSE streaming support.
 * @param {string} message - Message to send
 * @param {string|null} sessionId - Optional session ID
 * @param {Function} onDelta - Callback for delta events
 * @param {Function} onDone - Callback for done event
 * @param {string|null} model - Optional model ID
 * @returns {Promise<Object>} Final response data
 */
async function chat(message, sessionId, onDelta, onDone, model = null) {
  return new Promise((resolve, reject) => {
    const baseUrlStr = getApiBaseUrl();
    let baseUrl;
    
    try {
      baseUrl = new URL(baseUrlStr);
    } catch (err) {
      reject(new APIError(`Invalid API URL: ${baseUrlStr}`));
      return;
    }
    
    const body = {
      message,
      sessionId,
      stream: true,
      ...(model && { model }),
    };
    
    const postData = JSON.stringify(body);
    
    const requestOptions = {
      hostname: baseUrl.hostname,
      port: baseUrl.port || (baseUrl.protocol === 'https:' ? 443 : 80),
      path: '/api/chat',
      method: 'POST',
      timeout: DEFAULT_TIMEOUT,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'KimiBuilt-CLI/2.0.0',
      },
    };
    
    const httpModule = getHttpModule(baseUrlStr);
    
    const req = httpModule.request(requestOptions, (res) => {
      const returnedSessionId = res.headers['x-session-id'];
      let buffer = '';
      let finalSessionId = returnedSessionId;
      let finalResponseId = null;
      let hasReceivedData = false;
      
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          reject(new APIError(
            `Stream request failed with status ${res.statusCode}: ${errorData}`,
            res.statusCode
          ));
        });
        return;
      }
      
      res.on('data', (chunk) => {
        hasReceivedData = true;
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') {
              continue;
            }
            try {
              const event = JSON.parse(data);
              if (event.type === 'delta' && onDelta) {
                onDelta(event.content);
              } else if (event.type === 'done') {
                finalSessionId = event.sessionId || finalSessionId;
                finalResponseId = event.responseId || finalResponseId;
                if (onDone) {
                  onDone(event);
                }
              }
            } catch {
              // Ignore parse errors for malformed chunks
            }
          }
        }
      });
      
      res.on('end', () => {
        if (!hasReceivedData) {
          reject(new APIError('Stream ended without receiving any data'));
          return;
        }
        resolve({
          sessionId: finalSessionId,
          responseId: finalResponseId,
        });
      });
      
      res.on('error', (err) => {
        reject(new APIError(`Stream error: ${err.message}`));
      });
    });
    
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new APIError(
          `Connection refused. Please ensure the KimiBuilt server is running at ${baseUrlStr}`
        ));
      } else if (err.code === 'ENOTFOUND') {
        reject(new APIError(`Host not found: ${baseUrl.hostname}`));
      } else {
        reject(new APIError(`Request failed: ${err.message}`));
      }
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new APIError('Stream request timed out'));
    });
    
    req.write(postData);
    req.end();
  });
}

/**
 * Send a chat message without streaming.
 * @param {string} message - Message to send
 * @param {string|null} sessionId - Optional session ID
 * @param {string|null} model - Optional model ID
 * @returns {Promise<Object>} Response data
 */
async function chatNonStreaming(message, sessionId, model = null) {
  const body = {
    message,
    sessionId,
    stream: false,
    ...(model && { model }),
  };
  const response = await request('/api/chat', {
    method: 'POST',
    body,
  });
  return response;
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
async function canvas(message, sessionId, canvasType = 'document', existingContent = '', model = null) {
  const body = {
    message,
    sessionId,
    canvasType,
    ...(existingContent && { existingContent }),
    ...(model && { model }),
  };
  const response = await request('/api/canvas', {
    method: 'POST',
    body,
    timeout: 60000, // Canvas operations may take longer
  });
  return response;
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
async function notation(notationText, sessionId, helperMode = 'expand', context = '', model = null) {
  const body = {
    notation: notationText,
    sessionId,
    helperMode,
    ...(context && { context }),
    ...(model && { model }),
  };
  const response = await request('/api/notation', {
    method: 'POST',
    body,
  });
  return response;
}

/**
 * Create a new session.
 * @param {Object} metadata - Session metadata
 * @returns {Promise<Object>} Session data
 */
async function createSession(metadata = {}) {
  const response = await request('/api/sessions', {
    method: 'POST',
    body: { metadata },
  });
  return response;
}

/**
 * List all sessions.
 * @returns {Promise<Object>} Sessions list
 */
async function listSessions() {
  const response = await request('/api/sessions', {
    method: 'GET',
  });
  return response;
}

/**
 * Get a specific session by ID.
 * @param {string} sessionId - Session ID
 * @returns {Promise<Object>} Session data
 */
async function getSession(sessionId) {
  const response = await request(`/api/sessions/${sessionId}`, {
    method: 'GET',
  });
  return response;
}

/**
 * Delete a session.
 * @param {string} sessionId - Session ID to delete
 * @returns {Promise<boolean>} Success status
 */
async function deleteSession(sessionId) {
  try {
    await request(`/api/sessions/${sessionId}`, {
      method: 'DELETE',
    });
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Check if the API is accessible.
 * @returns {Promise<boolean>} True if API is reachable
 */
async function healthCheck() {
  try {
    await request('/api/health', {
      method: 'GET',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available chat models from the API.
 * @returns {Promise<Array>} Array of model objects
 */
async function getModels() {
  try {
    const response = await request('/api/models', {
      method: 'GET',
      timeout: 10000,
    });
    return response.data || [];
  } catch (err) {
    throw new APIError(`Failed to fetch models: ${err.message}`, err.statusCode);
  }
}

/**
 * Get available image generation models from the API.
 * @returns {Promise<Array>} Array of image model objects
 */
async function getImageModels() {
  try {
    const response = await request('/api/images/models', {
      method: 'GET',
      timeout: 10000,
    });
    return response.models || [];
  } catch (err) {
    throw new APIError(`Failed to fetch image models: ${err.message}`, err.statusCode);
  }
}

/**
 * Generate an image using the API.
 * @param {string} prompt - Image generation prompt
 * @param {Object} options - Generation options
 * @param {string} options.model - Model ID
 * @param {string} options.size - Image size (e.g., '1024x1024')
 * @param {string} options.quality - Image quality (standard or hd)
 * @param {string} options.style - Image style (vivid or natural)
 * @param {number} options.n - Number of images
 * @param {string|null} options.sessionId - Optional session ID
 * @returns {Promise<Object>} Response data with image URLs
 */
async function generateImage(prompt, options = {}) {
  const body = {
    prompt,
    ...(options.model && { model: options.model }),
    ...(options.size && { size: options.size }),
    ...(options.quality && { quality: options.quality }),
    ...(options.style && { style: options.style }),
    ...(options.n && { n: options.n }),
    ...(options.sessionId && { sessionId: options.sessionId }),
  };
  
  const response = await request('/api/images', {
    method: 'POST',
    body,
    timeout: 120000, // Image generation may take longer
  });
  
  return response;
}

module.exports = {
  APIError,
  request,
  chat,
  chatNonStreaming,
  canvas,
  notation,
  createSession,
  listSessions,
  getSession,
  deleteSession,
  healthCheck,
  getModels,
  getImageModels,
  generateImage,
  parseSSE,
};
