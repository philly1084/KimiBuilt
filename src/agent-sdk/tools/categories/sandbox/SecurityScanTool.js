/**
 * SecurityScanTool - Scan code for vulnerabilities and security issues
 */

const { ToolBase } = require('../../ToolBase');

class SecurityScanTool extends ToolBase {
  constructor() {
    super({
      id: 'security-scan',
      name: 'Security Scanner',
      description: 'Scan code for vulnerabilities, secrets, and security anti-patterns',
      category: 'sandbox',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 120000
      },
      inputSchema: {
        type: 'object',
        required: ['source'],
        properties: {
          source: {
            type: 'string',
            description: 'Code to scan'
          },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python', 'java', 'go', 'ruby', 'php'],
            default: 'javascript'
          },
          checks: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['secrets', 'vulnerabilities', 'dependencies', 'csp', 'xss', 'sql-injection', 'path-traversal']
            },
            default: ['secrets', 'vulnerabilities']
          },
          severity: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'low'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                severity: { type: 'string' },
                category: { type: 'string' },
                message: { type: 'string' },
                line: { type: 'integer' },
                column: { type: 'integer' },
                fix: { type: 'string' }
              }
            }
          },
          summary: {
            type: 'object',
            properties: {
              critical: { type: 'integer' },
              high: { type: 'integer' },
              medium: { type: 'integer' },
              low: { type: 'integer' },
              total: { type: 'integer' }
            }
          },
          score: { type: 'number' }
        }
      }
    });

    // Security patterns database
    this.patterns = this.initializePatterns();
  }

  async handler(params, context, tracker) {
    const {
      source,
      language = 'javascript',
      checks = ['secrets', 'vulnerabilities'],
      severity = 'low'
    } = params;

    const issues = [];

    // Run all enabled checks
    if (checks.includes('secrets')) {
      issues.push(...this.scanSecrets(source, language));
    }

    if (checks.includes('vulnerabilities')) {
      issues.push(...this.scanVulnerabilities(source, language));
    }

    if (checks.includes('xss')) {
      issues.push(...this.scanXSS(source, language));
    }

    if (checks.includes('sql-injection')) {
      issues.push(...this.scanSQLInjection(source, language));
    }

    if (checks.includes('path-traversal')) {
      issues.push(...this.scanPathTraversal(source, language));
    }

    // Filter by severity
    const severityLevels = { critical: 4, high: 3, medium: 2, low: 1 };
    const minLevel = severityLevels[severity] || 1;
    
    const filteredIssues = issues.filter(issue => 
      severityLevels[issue.severity] >= minLevel
    );

    // Calculate summary
    const summary = this.calculateSummary(filteredIssues);

    // Calculate security score (0-100)
    const score = this.calculateScore(filteredIssues, source.length);

    return {
      issues: filteredIssues,
      summary,
      score,
      scannedAt: new Date().toISOString()
    };
  }

  scanSecrets(source, language) {
    const issues = [];
    const lines = source.split('\n');

    const secretPatterns = [
      {
        pattern: /['"`]([a-zA-Z0-9_-]*(?:password|secret|key|token|api[_-]?key)[a-zA-Z0-9_-]*)['"`]\s*[:=]\s*['"`]([^'"`]{8,})['"`]/gi,
        category: 'hardcoded-secret',
        severity: 'critical',
        message: 'Hardcoded secret detected'
      },
      {
        pattern: /[a-zA-Z0-9_-]*(?:password|secret|key|token)\s*=\s*['"`]([^'"`]{8,})['"`]/gi,
        category: 'hardcoded-secret',
        severity: 'critical',
        message: 'Potential hardcoded credential'
      },
      {
        pattern: /(AKIA[0-9A-Z]{16})/g,
        category: 'aws-key',
        severity: 'critical',
        message: 'AWS Access Key ID detected'
      },
      {
        pattern: /(ghp_[a-zA-Z0-9]{36})/g,
        category: 'github-token',
        severity: 'critical',
        message: 'GitHub Personal Access Token detected'
      },
      {
        pattern: /(sk-[a-zA-Z0-9]{20,})/g,
        category: 'openai-key',
        severity: 'critical',
        message: 'OpenAI API Key detected'
      },
      {
        pattern: /(PRIVATE KEY)/g,
        category: 'private-key',
        severity: 'critical',
        message: 'Private key detected'
      },
      {
        pattern: /([a-zA-Z0-9_-]*\.(mongodb|redis|postgres|mysql)\.net)/gi,
        category: 'connection-string',
        severity: 'high',
        message: 'Database connection string detected'
      }
    ];

    lines.forEach((line, lineIndex) => {
      secretPatterns.forEach(({ pattern, category, severity, message }) => {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          // Skip if in comment
          if (this.isInComment(line, match.index)) return;

          issues.push({
            severity,
            category,
            message,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: match[0].substring(0, 50) + (match[0].length > 50 ? '...' : ''),
            fix: 'Move secret to environment variables or secure vault'
          });
        }
      });
    });

    return issues;
  }

  scanVulnerabilities(source, language) {
    const issues = [];
    const lines = source.split('\n');

    const vulnerabilityPatterns = {
      javascript: [
        {
          pattern: /eval\s*\(/g,
          severity: 'high',
          category: 'code-injection',
          message: 'eval() can execute arbitrary code',
          fix: 'Use JSON.parse() for JSON or safer alternatives'
        },
        {
          pattern: /new\s+Function\s*\(/g,
          severity: 'high',
          category: 'code-injection',
          message: 'Function constructor can execute arbitrary code',
          fix: 'Avoid dynamic code generation'
        },
        {
          pattern: /innerHTML\s*=/g,
          severity: 'medium',
          category: 'xss',
          message: 'innerHTML can lead to XSS',
          fix: 'Use textContent or sanitize HTML'
        },
        {
          pattern: /document\.write\s*\(/g,
          severity: 'medium',
          category: 'xss',
          message: 'document.write can lead to XSS',
          fix: 'Use DOM manipulation methods instead'
        },
        {
          pattern: /child_process/g,
          severity: 'medium',
          category: 'command-injection',
          message: 'Shell execution detected',
          fix: 'Validate and sanitize all inputs'
        },
        {
          pattern: /Math\.random\s*\(\s*\)/g,
          severity: 'low',
          category: 'weak-randomness',
          message: 'Math.random() is not cryptographically secure',
          fix: 'Use crypto.randomBytes() for security-sensitive operations'
        }
      ],
      python: [
        {
          pattern: /eval\s*\(/g,
          severity: 'high',
          category: 'code-injection',
          message: 'eval() can execute arbitrary code'
        },
        {
          pattern: /exec\s*\(/g,
          severity: 'high',
          category: 'code-injection',
          message: 'exec() can execute arbitrary code'
        },
        {
          pattern: /subprocess\.call.*shell\s*=\s*True/g,
          severity: 'high',
          category: 'command-injection',
          message: 'Shell=True with subprocess is dangerous'
        },
        {
          pattern: /pickle\.loads?\s*\(/g,
          severity: 'high',
          category: 'deserialization',
          message: 'pickle can execute arbitrary code during deserialization',
          fix: 'Use JSON for data serialization'
        },
        {
          pattern: /yaml\.load\s*\([^)]*\)/g,
          severity: 'high',
          category: 'deserialization',
          message: 'yaml.load without Loader is unsafe',
          fix: 'Use yaml.safe_load() instead'
        }
      ],
      sql: [
        {
          pattern: /EXEC\s*\(\s*@/gi,
          severity: 'high',
          category: 'sql-injection',
          message: 'Dynamic SQL execution detected'
        }
      ]
    };

    const patterns = vulnerabilityPatterns[language] || vulnerabilityPatterns.javascript;

    lines.forEach((line, lineIndex) => {
      patterns.forEach(({ pattern, severity, category, message, fix }) => {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          if (this.isInComment(line, match.index)) return;

          issues.push({
            severity,
            category,
            message,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: line.substring(match.index, match.index + 40).trim(),
            fix
          });
        }
      });
    });

    return issues;
  }

  scanXSS(source, language) {
    const issues = [];
    const lines = source.split('\n');

    const xssPatterns = [
      {
        pattern: /\.(innerHTML|outerHTML)\s*=[^;]*\+/g,
        severity: 'high',
        message: 'Potential XSS via string concatenation'
      },
      {
        pattern: /\.(innerHTML|outerHTML)\s*=\s*[^;]*\$\{/g,
        severity: 'high',
        message: 'Potential XSS via template literal'
      },
      {
        pattern: /dangerouslySetInnerHTML/g,
        severity: 'medium',
        message: 'dangerouslySetInnerHTML bypasses React XSS protection'
      }
    ];

    lines.forEach((line, lineIndex) => {
      xssPatterns.forEach(({ pattern, severity, message }) => {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          issues.push({
            severity,
            category: 'xss',
            message,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: line.trim(),
            fix: 'Sanitize user input before DOM insertion'
          });
        }
      });
    });

    return issues;
  }

  scanSQLInjection(source, language) {
    const issues = [];
    const lines = source.split('\n');

    const sqlPatterns = [
      {
        pattern: /(SELECT|INSERT|UPDATE|DELETE).*\+.*(?:req\.|request\.|params|body)/gi,
        severity: 'critical',
        message: 'Potential SQL injection via string concatenation'
      },
      {
        pattern: /query\s*\(\s*[^,]*\$\{/g,
        severity: 'critical',
        message: 'Potential SQL injection via template literal'
      },
      {
        pattern: /query\s*\(\s*[^,]*\+\s*req\./gi,
        severity: 'critical',
        message: 'SQL query concatenated with user input'
      },
      {
        pattern: /execute\s*\(\s*["'].*\$\{/g,
        severity: 'critical',
        message: 'Dynamic SQL with template literal'
      }
    ];

    lines.forEach((line, lineIndex) => {
      sqlPatterns.forEach(({ pattern, severity, message }) => {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          if (this.isInComment(line, match.index)) return;

          issues.push({
            severity,
            category: 'sql-injection',
            message,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: line.substring(0, 60).trim(),
            fix: 'Use parameterized queries or prepared statements'
          });
        }
      });
    });

    return issues;
  }

  scanPathTraversal(source, language) {
    const issues = [];
    const lines = source.split('\n');

    const pathPatterns = [
      {
        pattern: /fs\.(readFile|writeFile|appendFile)\s*\(\s*[^,]*\+\s*req\./g,
        severity: 'high',
        message: 'Potential path traversal via user input'
      },
      {
        pattern: /fs\.(readFile|writeFile).*path\.join.*req\./g,
        severity: 'medium',
        message: 'File path may include user input'
      },
      {
        pattern: /open\s*\(\s*[^,]*\+\s*.*(?:input|param)/g,
        severity: 'high',
        message: 'File path construction with user input'
      }
    ];

    lines.forEach((line, lineIndex) => {
      pathPatterns.forEach(({ pattern, severity, message }) => {
        let match;
        while ((match = pattern.exec(line)) !== null) {
          issues.push({
            severity,
            category: 'path-traversal',
            message,
            line: lineIndex + 1,
            column: match.index + 1,
            snippet: line.substring(0, 50).trim(),
            fix: 'Validate and sanitize file paths, use allowlists'
          });
        }
      });
    });

    return issues;
  }

  isInComment(line, position) {
    const beforeMatch = line.substring(0, position);
    const singleComment = beforeMatch.indexOf('//');
    const multiComment = beforeMatch.indexOf('/*');
    const multiEnd = beforeMatch.indexOf('*/');

    if (singleComment !== -1 && singleComment < position) return true;
    if (multiComment !== -1 && multiComment < position && (multiEnd === -1 || multiEnd > position)) return true;

    return false;
  }

  calculateSummary(issues) {
    const summary = { critical: 0, high: 0, medium: 0, low: 0, total: issues.length };
    
    issues.forEach(issue => {
      if (summary[issue.severity] !== undefined) {
        summary[issue.severity]++;
      }
    });

    return summary;
  }

  calculateScore(issues, codeLength) {
    // Base score starts at 100
    let score = 100;

    // Deduct points for issues
    issues.forEach(issue => {
      switch (issue.severity) {
        case 'critical': score -= 15; break;
        case 'high': score -= 10; break;
        case 'medium': score -= 5; break;
        case 'low': score -= 2; break;
      }
    });

    // Normalize to 0-100
    return Math.max(0, Math.min(100, score));
  }

  initializePatterns() {
    return {
      secrets: [],
      vulnerabilities: [],
      xss: [],
      sqlInjection: [],
      pathTraversal: []
    };
  }
}

module.exports = { SecurityScanTool };
