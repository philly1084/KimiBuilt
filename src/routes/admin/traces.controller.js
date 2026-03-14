/**
 * Traces Controller
 * Manages execution traces and timelines
 */

class TracesController {
  constructor() {
    this.traces = new Map();
    this.loadDefaultTraces();
  }

  loadDefaultTraces() {
    const defaultTrace = {
      id: 'trace-1',
      taskId: 'task-abc-123',
      sessionId: 'session-xyz',
      status: 'completed',
      startTime: new Date(Date.now() - 3600000).toISOString(),
      endTime: new Date(Date.now() - 3590000).toISOString(),
      duration: 10000,
      model: 'gpt-4o',
      input: 'Create a React component for a todo list',
      output: 'Here is the React component...',
      timeline: [
        {
          step: 1,
          type: 'planning',
          name: 'Task Analysis',
          startTime: new Date(Date.now() - 3600000).toISOString(),
          endTime: new Date(Date.now() - 3599800).toISOString(),
          duration: 200,
          status: 'completed',
          details: {
            detectedIntent: 'code_generation',
            requiredTools: ['code_writer'],
            complexity: 'medium'
          }
        },
        {
          step: 2,
          type: 'tool_call',
          name: 'Generate Code',
          startTime: new Date(Date.now() - 3599800).toISOString(),
          endTime: new Date(Date.now() - 3595000).toISOString(),
          duration: 4800,
          status: 'completed',
          details: {
            tool: 'code_writer',
            input: 'Create React todo component',
            output: '65 lines of code generated'
          }
        },
        {
          step: 3,
          type: 'verification',
          name: 'Code Review',
          startTime: new Date(Date.now() - 3595000).toISOString(),
          endTime: new Date(Date.now() - 3592000).toISOString(),
          duration: 3000,
          status: 'completed',
          details: {
            checks: ['syntax', 'best_practices', 'security'],
            issues: 0,
            warnings: 1
          }
        },
        {
          step: 4,
          type: 'completion',
          name: 'Task Complete',
          startTime: new Date(Date.now() - 3592000).toISOString(),
          endTime: new Date(Date.now() - 3590000).toISOString(),
          duration: 2000,
          status: 'completed',
          details: {
            result: 'success',
            tokensUsed: 2450
          }
        }
      ],
      metrics: {
        totalTokens: 2450,
        promptTokens: 45,
        completionTokens: 2405,
        toolCalls: 1,
        retries: 0
      },
      createdAt: new Date(Date.now() - 3600000).toISOString()
    };

    this.traces.set(defaultTrace.id, defaultTrace);
  }

  /**
   * Get all traces
   */
  async getAll(req, res) {
    try {
      const { status, model, from, to, page = 1, limit = 20 } = req.query;

      let traces = Array.from(this.traces.values());

      if (status && status !== 'all') {
        traces = traces.filter(t => t.status === status);
      }

      if (model && model !== 'all') {
        traces = traces.filter(t => t.model === model);
      }

      if (from) {
        const fromDate = new Date(from);
        traces = traces.filter(t => new Date(t.startTime) >= fromDate);
      }

      if (to) {
        const toDate = new Date(to);
        traces = traces.filter(t => new Date(t.endTime) <= toDate);
      }

      // Sort by start time descending
      traces.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));

      // Pagination
      const total = traces.length;
      const offset = (page - 1) * limit;
      const paginated = traces.slice(offset, offset + parseInt(limit));

      res.json({
        success: true,
        data: paginated,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Error getting traces:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get trace by ID
   */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const trace = this.traces.get(id);

      if (!trace) {
        return res.status(404).json({ success: false, error: 'Trace not found' });
      }

      res.json({ success: true, data: trace });
    } catch (error) {
      console.error('Error getting trace:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Get trace timeline
   */
  async getTimeline(req, res) {
    try {
      const { id } = req.params;
      const trace = this.traces.get(id);

      if (!trace) {
        return res.status(404).json({ success: false, error: 'Trace not found' });
      }

      res.json({
        success: true,
        data: {
          traceId: id,
          timeline: trace.timeline,
          totalSteps: trace.timeline.length,
          duration: trace.duration
        }
      });
    } catch (error) {
      console.error('Error getting timeline:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Delete trace
   */
  async remove(req, res) {
    try {
      const { id } = req.params;

      if (!this.traces.has(id)) {
        return res.status(404).json({ success: false, error: 'Trace not found' });
      }

      this.traces.delete(id);

      res.json({ success: true, data: { id, deleted: true } });
    } catch (error) {
      console.error('Error deleting trace:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Export traces
   */
  async export(req, res) {
    try {
      const { format } = req.params;
      const { status, from, to } = req.query;

      let traces = Array.from(this.traces.values());

      if (status && status !== 'all') {
        traces = traces.filter(t => t.status === status);
      }

      if (from || to) {
        const fromDate = from ? new Date(from) : new Date(0);
        const toDate = to ? new Date(to) : new Date();
        traces = traces.filter(t => {
          const date = new Date(t.startTime);
          return date >= fromDate && date <= toDate;
        });
      }

      switch (format) {
        case 'json':
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Content-Disposition', 'attachment; filename="traces.json"');
          res.json(traces);
          break;

        case 'markdown':
          res.setHeader('Content-Type', 'text/markdown');
          res.setHeader('Content-Disposition', 'attachment; filename="traces.md"');
          
          let md = '# Agent SDK Traces\n\n';
          traces.forEach(trace => {
            md += `## Trace ${trace.id}\n\n`;
            md += `- **Status:** ${trace.status}\n`;
            md += `- **Model:** ${trace.model}\n`;
            md += `- **Duration:** ${trace.duration}ms\n`;
            md += `- **Start:** ${trace.startTime}\n\n`;
            md += '### Timeline\n\n';
            trace.timeline.forEach(step => {
              md += `#### ${step.step}. ${step.name}\n`;
              md += `- Type: ${step.type}\n`;
              md += `- Status: ${step.status}\n`;
              md += `- Duration: ${step.duration}ms\n\n`;
            });
            md += '---\n\n';
          });
          
          res.send(md);
          break;

        default:
          res.status(400).json({ success: false, error: 'Unsupported format' });
      }
    } catch (error) {
      console.error('Error exporting traces:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Add trace (called by other controllers)
   */
  addTrace(trace) {
    this.traces.set(trace.id, trace);
  }
}

module.exports = new TracesController();
