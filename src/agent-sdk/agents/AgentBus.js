/**
 * AgentBus - Inter-agent communication system
 * Enables agents to send messages, delegate tasks, and broadcast events
 */

const EventEmitter = require('events');

class AgentBus extends EventEmitter {
  constructor() {
    super();
    
    // Registered agents
    this.agents = new Map();
    
    // Message queues per agent
    this.queues = new Map();
    
    // Pending requests (for request/response pattern)
    this.pendingRequests = new Map();
    
    // Message history
    this.history = [];
    this.maxHistory = 1000;
    
    // Request counter for unique IDs
    this.requestIdCounter = 0;
  }

  /**
   * Register an agent with the bus
   */
  registerAgent(agent) {
    const { id, type, capabilities = [] } = agent;
    
    this.agents.set(id, {
      id,
      type,
      capabilities,
      status: 'idle',
      registeredAt: new Date().toISOString()
    });
    
    this.queues.set(id, []);
    
    this.emit('agent:registered', { id, type, capabilities });
    console.log(`[AgentBus] Agent registered: ${id} (${type})`);
    
    return this;
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId) {
    const existed = this.agents.has(agentId);
    
    this.agents.delete(agentId);
    this.queues.delete(agentId);
    
    if (existed) {
      this.emit('agent:unregistered', { id: agentId });
    }
    
    return existed;
  }

  /**
   * Send a message to a specific agent
   */
  async send(to, message, from = 'system') {
    const envelope = {
      id: this.generateMessageId(),
      type: 'direct',
      to,
      from,
      payload: message,
      timestamp: new Date().toISOString()
    };
    
    // Add to recipient's queue
    if (this.queues.has(to)) {
      this.queues.get(to).push(envelope);
    }
    
    // Record in history
    this.recordHistory(envelope);
    
    // Emit for listeners
    this.emit('message', envelope);
    this.emit(`message:${to}`, envelope);
    
    return envelope.id;
  }

  /**
   * Request/Response pattern
   */
  async request(to, request, from = 'system', timeout = 30000) {
    const requestId = this.generateRequestId();
    
    const envelope = {
      id: this.generateMessageId(),
      type: 'request',
      requestId,
      to,
      from,
      payload: request,
      timestamp: new Date().toISOString()
    };
    
    // Set up promise for response
    const responsePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} to ${to} timed out`));
      }, timeout);
      
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutId,
        timestamp: Date.now()
      });
    });
    
    // Send request
    if (this.queues.has(to)) {
      this.queues.get(to).push(envelope);
    }
    
    this.recordHistory(envelope);
    this.emit('request', envelope);
    
    return responsePromise;
  }

  /**
   * Send a response to a request
   */
  async respond(requestId, response, from = 'system') {
    const pending = this.pendingRequests.get(requestId);
    
    if (!pending) {
      console.warn(`[AgentBus] No pending request for ID: ${requestId}`);
      return false;
    }
    
    // Clear timeout
    clearTimeout(pending.timeoutId);
    this.pendingRequests.delete(requestId);
    
    // Resolve the promise
    pending.resolve({
      requestId,
      payload: response,
      from,
      timestamp: new Date().toISOString()
    });
    
    return true;
  }

  /**
   * Broadcast a message to all agents
   */
  async broadcast(payload, from = 'system', exclude = []) {
    const envelope = {
      id: this.generateMessageId(),
      type: 'broadcast',
      from,
      payload,
      timestamp: new Date().toISOString()
    };
    
    // Add to all queues except excluded
    for (const [agentId, queue] of this.queues) {
      if (!exclude.includes(agentId)) {
        queue.push(envelope);
      }
    }
    
    this.recordHistory(envelope);
    this.emit('broadcast', envelope);
    
    return envelope.id;
  }

  /**
   * Publish to a topic (pub/sub)
   */
  async publish(topic, payload, from = 'system') {
    const envelope = {
      id: this.generateMessageId(),
      type: 'publish',
      topic,
      from,
      payload,
      timestamp: new Date().toISOString()
    };
    
    this.recordHistory(envelope);
    this.emit(`topic:${topic}`, envelope);
    this.emit('publish', envelope);
    
    return envelope.id;
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic, handler) {
    this.on(`topic:${topic}`, handler);
    
    // Return unsubscribe function
    return () => {
      this.off(`topic:${topic}`, handler);
    };
  }

  /**
   * Get messages for an agent
   */
  getMessages(agentId, clear = true) {
    const queue = this.queues.get(agentId);
    if (!queue) return [];
    
    const messages = [...queue];
    
    if (clear) {
      queue.length = 0;
    }
    
    return messages;
  }

  /**
   * Wait for next message for an agent
   */
  async waitForMessage(agentId, timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Timeout waiting for message to ${agentId}`));
      }, timeout);
      
      const handler = (envelope) => {
        cleanup();
        resolve(envelope);
      };
      
      const cleanup = () => {
        clearTimeout(timeoutId);
        this.off(`message:${agentId}`, handler);
      };
      
      this.once(`message:${agentId}`, handler);
    });
  }

  /**
   * Delegate a task to the best available agent
   */
  async delegate(task, requiredCapabilities = [], from = 'system') {
    // Find agents with required capabilities
    const candidates = Array.from(this.agents.values())
      .filter(agent => agent.status === 'idle')
      .filter(agent => 
        requiredCapabilities.every(cap => 
          agent.capabilities.includes(cap)
        )
      );
    
    if (candidates.length === 0) {
      throw new Error(`No available agents with capabilities: ${requiredCapabilities.join(', ')}`);
    }
    
    // Select first available (could use more sophisticated selection)
    const selected = candidates[0];
    
    // Mark as busy
    this.agents.get(selected.id).status = 'busy';
    
    // Send task
    const messageId = await this.send(selected.id, {
      type: 'task',
      task
    }, from);
    
    this.emit('task:delegated', {
      taskId: task.id,
      to: selected.id,
      from,
      messageId
    });
    
    return {
      agentId: selected.id,
      messageId,
      waitForCompletion: () => this.waitForTaskCompletion(selected.id, task.id)
    };
  }

  /**
   * Wait for task completion
   */
  async waitForTaskCompletion(agentId, taskId, timeout = 120000) {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        const agent = this.agents.get(agentId);
        if (agent && agent.status === 'idle') {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(agent.lastResult);
        }
      }, 100);
      
      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error(`Task ${taskId} on agent ${agentId} timed out`));
      }, timeout);
    });
  }

  /**
   * Update agent status
   */
  setAgentStatus(agentId, status, result = null) {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = status;
      agent.lastStatusChange = new Date().toISOString();
      
      if (result) {
        agent.lastResult = result;
      }
      
      this.emit('agent:status', { agentId, status, result });
    }
  }

  /**
   * Get all registered agents
   */
  getAgents() {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by type
   */
  getAgentsByType(type) {
    return this.getAgents().filter(agent => agent.type === type);
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability) {
    return this.getAgents().filter(agent => 
      agent.capabilities.includes(capability)
    );
  }

  /**
   * Record message in history
   */
  recordHistory(envelope) {
    this.history.push(envelope);
    
    // Trim history
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
  }

  /**
   * Get message history
   */
  getHistory(filter = {}) {
    let filtered = [...this.history];
    
    if (filter.from) {
      filtered = filtered.filter(m => m.from === filter.from);
    }
    
    if (filter.to) {
      filtered = filtered.filter(m => m.to === filter.to);
    }
    
    if (filter.type) {
      filtered = filtered.filter(m => m.type === filter.type);
    }
    
    if (filter.since) {
      filtered = filtered.filter(m => new Date(m.timestamp) >= filter.since);
    }
    
    return filtered;
  }

  /**
   * Clear history
   */
  clearHistory() {
    this.history = [];
  }

  /**
   * Get bus statistics
   */
  getStats() {
    return {
      agents: this.agents.size,
      messages: this.history.length,
      pendingRequests: this.pendingRequests.size,
      queueSizes: Array.from(this.queues.entries()).map(([id, queue]) => ({
        agentId: id,
        size: queue.length
      }))
    };
  }

  // Private helpers

  generateMessageId() {
    return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  generateRequestId() {
    return `req-${++this.requestIdCounter}-${Date.now()}`;
  }
}

// Singleton instance
let instance = null;

function getAgentBus() {
  if (!instance) {
    instance = new AgentBus();
  }
  return instance;
}

module.exports = { AgentBus, getAgentBus };
