/**
 * Traces Controller
 * Manages execution traces and timelines
 */

const path = require('path');
const { PROJECT_ROOT, resolvePreferredWritableFile } = require('../../runtime-state-paths');
const {
  appendJsonlRecordSync,
  readJsonlRecordsSync,
  writeJsonlRecordsSync,
} = require('../../observability/jsonl-persistence');

function getTracesStoragePath() {
  return resolvePreferredWritableFile(
    path.join(PROJECT_ROOT, 'data', 'observability', 'traces.jsonl'),
    ['observability', 'traces.jsonl'],
  );
}

class TracesController {
  constructor(options = {}) {
    this.storagePath = path.resolve(options.storagePath || getTracesStoragePath());
    this.traces = new Map(
      readJsonlRecordsSync(this.storagePath)
        .filter((trace) => trace?.id)
        .map((trace) => [trace.id, trace]),
    );
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
      writeJsonlRecordsSync(this.storagePath, Array.from(this.traces.values()));

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
    appendJsonlRecordSync(this.storagePath, trace);
  }
}

module.exports = new TracesController();
module.exports.TracesController = TracesController;
module.exports.getTracesStoragePath = getTracesStoragePath;
