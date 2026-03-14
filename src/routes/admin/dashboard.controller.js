/**
 * Dashboard Controller
 * Handles dashboard overview and SDK control endpoints
 */

const { v4: uuidv4 } = require('uuid');

class DashboardController {
  constructor(agentOrchestrator) {
    this.orchestrator = agentOrchestrator;
    this.taskStore = new Map();
    this.sessionStore = new Map();
    this.activityLog = [];
    this.maxActivityItems = 100;
  }

  /**
   * Get dashboard statistics
   */
  async getStats(req, res) {
    try {
      const stats = {
        overview: {
          totalTasks: this.taskStore.size,
          successfulTasks: Array.from(this.taskStore.values()).filter(t => t.status === 'completed').length,
          failedTasks: Array.from(this.taskStore.values()).filter(t => t.status === 'failed').length,
          activeSessions: this.sessionStore.size,
          totalSkills: await this.getSkillCount(),
          totalTraces: await this.getTraceCount(),
          avgResponseTime: this.calculateAvgResponseTime(),
          successRate: this.calculateSuccessRate()
        },
        requests: {
          today: this.getRequestCount('day'),
          thisWeek: this.getRequestCount('week'),
          thisMonth: this.getRequestCount('month'),
          total: this.taskStore.size
        },
        models: await this.getModelUsageStats(),
        timestamp: new Date().toISOString()
      };

      res.json({ success: true, data: stats });
    } catch (error) {
      console.error('Error getting stats:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get system health status
   */
  async getHealth(req, res) {
    try {
      const health = {
        status: 'healthy',
        services: {
          sdk: this.orchestrator ? 'connected' : 'disconnected',
          vectorStore: await this.checkVectorStore(),
          llmClient: await this.checkLLMClient(),
          embedder: await this.checkEmbedder()
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString()
      };

      // Determine overall status
      const services = Object.values(health.services);
      if (services.every(s => s === 'connected' || s === 'available')) {
        health.status = 'healthy';
      } else if (services.some(s => s === 'connected' || s === 'available')) {
        health.status = 'degraded';
      } else {
        health.status = 'unhealthy';
      }

      res.json({ success: true, data: health });
    } catch (error) {
      console.error('Error getting health:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message,
        data: { status: 'error', timestamp: new Date().toISOString() }
      });
    }
  }

  /**
   * Get recent activity
   */
  async getRecentActivity(req, res) {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const activity = this.activityLog
        .slice(-limit)
        .reverse()
        .map(item => ({
          id: item.id,
          type: item.type,
          description: item.description,
          timestamp: item.timestamp,
          metadata: item.metadata
        }));

      res.json({ success: true, data: activity });
    } catch (error) {
      console.error('Error getting activity:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Execute a new task via SDK
   */
  async executeTask(req, res) {
    try {
      const { prompt, model, tools = [], options = {} } = req.body;
      
      if (!prompt) {
        return res.status(400).json({ success: false, error: 'Prompt is required' });
      }

      const taskId = uuidv4();
      const sessionId = options.sessionId || uuidv4();

      // Create task configuration
      const taskConfig = {
        id: taskId,
        sessionId,
        input: prompt,
        model: model || 'gpt-4o',
        tools,
        options: {
          enableTracing: true,
          enableSkills: true,
          ...options
        }
      };

      // Store task
      this.taskStore.set(taskId, {
        ...taskConfig,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Update session
      if (!this.sessionStore.has(sessionId)) {
        this.sessionStore.set(sessionId, {
          id: sessionId,
          tasks: [],
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString()
        });
      }
      this.sessionStore.get(sessionId).tasks.push(taskId);
      this.sessionStore.get(sessionId).lastActivity = new Date().toISOString();

      // Log activity
      this.logActivity('task_created', `Task created: ${taskId.substring(0, 8)}...`, { taskId, sessionId });

      // Execute task if orchestrator is available
      let result = null;
      if (this.orchestrator) {
        try {
          this.taskStore.get(taskId).status = 'running';
          result = await this.orchestrator.execute(taskConfig);
          
          this.taskStore.get(taskId).status = 'completed';
          this.taskStore.get(taskId).result = result;
          this.taskStore.get(taskId).completedAt = new Date().toISOString();
          
          this.logActivity('task_completed', `Task completed: ${taskId.substring(0, 8)}...`, { taskId, duration: result.duration });
        } catch (execError) {
          this.taskStore.get(taskId).status = 'failed';
          this.taskStore.get(taskId).error = execError.message;
          this.taskStore.get(taskId).failedAt = new Date().toISOString();
          
          this.logActivity('task_failed', `Task failed: ${taskId.substring(0, 8)}...`, { taskId, error: execError.message });
          throw execError;
        }
      }

      res.json({
        success: true,
        data: {
          taskId,
          sessionId,
          status: this.taskStore.get(taskId).status,
          result: result ? {
            output: result.output,
            trace: result.trace,
            skillsUsed: result.skillsUsed,
            tokensUsed: result.tokensUsed,
            duration: result.duration
          } : null
        }
      });
    } catch (error) {
      console.error('Error executing task:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Cancel a running task
   */
  async cancelTask(req, res) {
    try {
      const { taskId } = req.params;
      const task = this.taskStore.get(taskId);

      if (!task) {
        return res.status(404).json({ success: false, error: 'Task not found' });
      }

      if (task.status !== 'running') {
        return res.status(400).json({ success: false, error: 'Task is not running' });
      }

      // Cancel logic here if orchestrator supports it
      task.status = 'cancelled';
      task.cancelledAt = new Date().toISOString();

      this.logActivity('task_cancelled', `Task cancelled: ${taskId.substring(0, 8)}...`, { taskId });

      res.json({ success: true, data: { taskId, status: 'cancelled' } });
    } catch (error) {
      console.error('Error cancelling task:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get all active sessions
   */
  async getActiveSessions(req, res) {
    try {
      const sessions = Array.from(this.sessionStore.values())
        .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
        .map(session => ({
          id: session.id,
          taskCount: session.tasks.length,
          createdAt: session.createdAt,
          lastActivity: session.lastActivity,
          isActive: (new Date() - new Date(session.lastActivity)) < 30 * 60 * 1000 // 30 min
        }));

      res.json({ success: true, data: sessions });
    } catch (error) {
      console.error('Error getting sessions:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get session details
   */
  async getSessionDetails(req, res) {
    try {
      const { id } = req.params;
      const session = this.sessionStore.get(id);

      if (!session) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      const tasks = session.tasks.map(taskId => {
        const task = this.taskStore.get(taskId);
        return task ? {
          id: task.id,
          status: task.status,
          input: task.input?.substring(0, 100) + '...',
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          duration: task.result?.duration
        } : null;
      }).filter(Boolean);

      res.json({
        success: true,
        data: {
          ...session,
          tasks
        }
      });
    } catch (error) {
      console.error('Error getting session details:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Clear a session
   */
  async clearSession(req, res) {
    try {
      const { id } = req.params;
      
      if (!this.sessionStore.has(id)) {
        return res.status(404).json({ success: false, error: 'Session not found' });
      }

      // Remove session tasks from store
      const session = this.sessionStore.get(id);
      session.tasks.forEach(taskId => {
        this.taskStore.delete(taskId);
      });

      this.sessionStore.delete(id);

      this.logActivity('session_cleared', `Session cleared: ${id.substring(0, 8)}...`, { sessionId: id });

      res.json({ success: true, data: { sessionId: id, cleared: true } });
    } catch (error) {
      console.error('Error clearing session:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  // Helper methods

  logActivity(type, description, metadata = {}) {
    this.activityLog.push({
      id: uuidv4(),
      type,
      description,
      timestamp: new Date().toISOString(),
      metadata
    });

    // Keep only recent items
    if (this.activityLog.length > this.maxActivityItems) {
      this.activityLog = this.activityLog.slice(-this.maxActivityItems);
    }
  }

  async getSkillCount() {
    if (this.orchestrator?.skillMemory) {
      try {
        return await this.orchestrator.skillMemory.count() || 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  async getTraceCount() {
    return Array.from(this.taskStore.values()).filter(t => t.result?.trace).length;
  }

  calculateAvgResponseTime() {
    const completed = Array.from(this.taskStore.values())
      .filter(t => t.result?.duration);
    
    if (completed.length === 0) return 0;
    
    const total = completed.reduce((sum, t) => sum + (t.result.duration || 0), 0);
    return Math.round(total / completed.length);
  }

  calculateSuccessRate() {
    const completed = Array.from(this.taskStore.values())
      .filter(t => t.status === 'completed' || t.status === 'failed');
    
    if (completed.length === 0) return 100;
    
    const successful = completed.filter(t => t.status === 'completed').length;
    return Math.round((successful / completed.length) * 100);
  }

  getRequestCount(period) {
    const now = new Date();
    const tasks = Array.from(this.taskStore.values());

    return tasks.filter(t => {
      const created = new Date(t.createdAt);
      const diff = now - created;
      
      switch (period) {
        case 'day':
          return diff < 24 * 60 * 60 * 1000;
        case 'week':
          return diff < 7 * 24 * 60 * 60 * 1000;
        case 'month':
          return diff < 30 * 24 * 60 * 60 * 1000;
        default:
          return true;
      }
    }).length;
  }

  async getModelUsageStats() {
    const modelCounts = {};
    
    Array.from(this.taskStore.values()).forEach(task => {
      const model = task.model || 'unknown';
      modelCounts[model] = (modelCounts[model] || 0) + 1;
    });

    return Object.entries(modelCounts).map(([name, count]) => ({
      name,
      count,
      percentage: this.taskStore.size > 0 ? Math.round((count / this.taskStore.size) * 100) : 0
    }));
  }

  async checkVectorStore() {
    if (this.orchestrator?.vectorStore) {
      try {
        await this.orchestrator.vectorStore.health();
        return 'connected';
      } catch {
        return 'disconnected';
      }
    }
    return 'not_configured';
  }

  async checkLLMClient() {
    if (this.orchestrator?.llmClient) {
      return 'connected';
    }
    return 'not_configured';
  }

  async checkEmbedder() {
    if (this.orchestrator?.embedder) {
      return 'connected';
    }
    return 'not_configured';
  }
}

module.exports = DashboardController;
