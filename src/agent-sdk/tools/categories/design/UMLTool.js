/**
 * UMLTool - Generate UML diagrams from code or descriptions
 */

const { ToolBase } = require('../../ToolBase');

class UMLTool extends ToolBase {
  constructor() {
    super({
      id: 'uml-generate',
      name: 'UML Generator',
      description: 'Generate UML class, sequence, and activity diagrams from code or descriptions',
      category: 'design',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['source'],
        properties: {
          source: {
            type: 'string',
            description: 'Code or description to generate UML from'
          },
          type: {
            type: 'string',
            enum: ['class', 'sequence', 'activity', 'usecase', 'component', 'state'],
            default: 'class',
            description: 'UML diagram type'
          },
          language: {
            type: 'string',
            enum: ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'auto'],
            default: 'auto',
            description: 'Source code language'
          },
          format: {
            type: 'string',
            enum: ['mermaid', 'plantuml'],
            default: 'mermaid'
          },
          options: {
            type: 'object',
            properties: {
              showMethods: { type: 'boolean', default: true },
              showProperties: { type: 'boolean', default: true },
              showTypes: { type: 'boolean', default: true },
              includePrivate: { type: 'boolean', default: false },
              maxDepth: { type: 'integer', default: 3 }
            }
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          diagram: { type: 'string' },
          type: { type: 'string' },
          format: { type: 'string' },
          elements: {
            type: 'object',
            properties: {
              classes: { type: 'integer' },
              relationships: { type: 'integer' },
              methods: { type: 'integer' }
            }
          }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      source,
      type = 'class',
      language = 'auto',
      format = 'mermaid',
      options = {}
    } = params;

    // Detect language if auto
    const detectedLang = language === 'auto' ? this.detectLanguage(source) : language;

    // Parse source based on type
    let parsed;
    if (type === 'class') {
      parsed = this.parseClassDiagram(source, detectedLang);
    } else if (type === 'sequence') {
      parsed = this.parseSequenceDiagram(source);
    } else if (type === 'activity') {
      parsed = this.parseActivityDiagram(source);
    } else {
      parsed = { elements: [], relationships: [] };
    }

    // Generate diagram
    const diagram = this.generateDiagram(parsed, type, format, options);

    // Count elements
    const elements = {
      classes: parsed.elements?.length || 0,
      relationships: parsed.relationships?.length || 0,
      methods: parsed.elements?.reduce((sum, e) => sum + (e.methods?.length || 0), 0) || 0
    };

    return {
      diagram,
      type,
      format,
      elements,
      language: detectedLang
    };
  }

  detectLanguage(source) {
    // Simple language detection
    if (source.includes('interface ') && source.includes(': ')) return 'typescript';
    if (source.includes('class ') && source.includes('def ')) return 'python';
    if (source.includes('public class') || source.includes('private class')) return 'java';
    if (source.includes('func ') || source.includes('package main')) return 'go';
    if (source.includes('class ') && source.includes('constructor')) return 'javascript';
    return 'javascript';
  }

  parseClassDiagram(source, language) {
    const elements = [];
    const relationships = [];

    // Regex patterns for different languages
    const patterns = {
      javascript: {
        class: /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*\{/g,
        method: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/g,
        property: /(?:this\.)?(\w+)\s*[=:]/g
      },
      typescript: {
        class: /class\s+(\w+)(?:\s+extends\s+(\w+))?\s*(?:implements\s+([\w,\s]+))?\s*\{/g,
        interface: /interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/g,
        method: /(\w+)\s*\([^)]*\)\s*:\s*\w+/g,
        property: /(\w+)\s*[=:]\s*\w+/g
      },
      python: {
        class: /class\s+(\w+)(?:\s*\(\s*(\w+)\s*\))?\s*:/g,
        method: /def\s+(\w+)\s*\(self[^)]*\)/g,
        property: /self\.(\w+)\s*=/g
      }
    };

    const pattern = patterns[language] || patterns.javascript;

    // Extract classes
    let match;
    while ((match = pattern.class.exec(source)) !== null) {
      const className = match[1];
      const parent = match[2];
      
      const classElement = {
        name: className,
        type: 'class',
        methods: [],
        properties: []
      };

      // Find class body (simplified)
      const classStart = match.index;
      const classBody = this.extractBody(source, classStart + match[0].length);

      // Extract methods
      if (pattern.method) {
        let methodMatch;
        const methodPattern = new RegExp(pattern.method.source, 'g');
        while ((methodMatch = methodPattern.exec(classBody)) !== null) {
          classElement.methods.push({
            name: methodMatch[1],
            visibility: methodMatch[0].includes('private') || methodMatch[0].startsWith('_') ? 'private' : 'public'
          });
        }
      }

      // Extract properties
      if (pattern.property) {
        let propMatch;
        const propPattern = new RegExp(pattern.property.source, 'g');
        while ((propMatch = propPattern.exec(classBody)) !== null) {
          classElement.properties.push({
            name: propMatch[1],
            visibility: 'public'
          });
        }
      }

      elements.push(classElement);

      // Add inheritance relationship
      if (parent) {
        relationships.push({
          from: className,
          to: parent,
          type: 'inheritance'
        });
      }
    }

    // Look for composition/aggregation patterns
    const compositionPattern = /new\s+(\w+)\s*\(/g;
    while ((match = compositionPattern.exec(source)) !== null) {
      // Find which class this is in
      const className = this.findEnclosingClass(source, match.index);
      if (className) {
        relationships.push({
          from: className,
          to: match[1],
          type: 'composition'
        });
      }
    }

    return { elements, relationships };
  }

  parseSequenceDiagram(source) {
    const elements = [];
    const relationships = [];

    // Parse calls like: Service.method() or await service.method()
    const callPattern = /(?:await\s+)?(\w+)\.(\w+)\s*\(/g;
    let match;

    while ((match = callPattern.exec(source)) !== null) {
      const participant = match[1];
      const method = match[2];

      if (!elements.find(e => e.name === participant)) {
        elements.push({ name: participant, type: 'participant' });
      }

      relationships.push({
        from: 'Caller', // Simplified
        to: participant,
        message: method
      });
    }

    return { elements, relationships };
  }

  parseActivityDiagram(source) {
    // Parse control flow keywords
    const elements = [];
    const relationships = [];

    const keywords = [
      { pattern: /if\s*\(/g, type: 'decision', label: 'Condition' },
      { pattern: /for\s*\(/g, type: 'loop', label: 'Loop' },
      { pattern: /while\s*\(/g, type: 'loop', label: 'While Loop' },
      { pattern: /try\s*\{/g, type: 'try', label: 'Try' },
      { pattern: /catch\s*\(/g, type: 'catch', label: 'Catch' }
    ];

    keywords.forEach(({ pattern, type, label }) => {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        elements.push({
          name: `${label}_${elements.length}`,
          type,
          position: match.index
        });
      }
    });

    return { elements, relationships };
  }

  generateDiagram(parsed, type, format, options) {
    if (format === 'mermaid') {
      return this.generateMermaid(parsed, type, options);
    } else if (format === 'plantuml') {
      return this.generatePlantUML(parsed, type, options);
    }
    return '';
  }

  generateMermaid(parsed, type, options) {
    const { showMethods = true, showProperties = true, includePrivate = false } = options;

    if (type === 'class') {
      let diagram = 'classDiagram\n';

      // Generate classes
      parsed.elements.forEach(element => {
        diagram += `  class ${element.name}{\n`;

        if (showProperties && element.properties) {
          element.properties
            .filter(p => includePrivate || p.visibility !== 'private')
            .forEach(p => {
              const symbol = p.visibility === 'private' ? '-' : '+';
              diagram += `    ${symbol}${p.name}\n`;
            });
        }

        if (showMethods && element.methods) {
          element.methods
            .filter(m => includePrivate || m.visibility !== 'private')
            .forEach(m => {
              const symbol = m.visibility === 'private' ? '-' : '+';
              diagram += `    ${symbol}${m.name}()\n`;
            });
        }

        diagram += '  }\n';
      });

      // Generate relationships
      parsed.relationships.forEach(rel => {
        if (rel.type === 'inheritance') {
          diagram += `  ${rel.to} <|-- ${rel.from}\n`;
        } else if (rel.type === 'composition') {
          diagram += `  ${rel.from} *-- ${rel.to}\n`;
        } else {
          diagram += `  ${rel.from} --> ${rel.to}\n`;
        }
      });

      return diagram;
    }

    if (type === 'sequence') {
      let diagram = 'sequenceDiagram\n';

      // Declare participants
      parsed.elements.forEach(e => {
        diagram += `  participant ${e.name}\n`;
      });

      // Add messages
      parsed.relationships.forEach(rel => {
        diagram += `  ${rel.from}->>${rel.to}: ${rel.message}\n`;
      });

      return diagram;
    }

    if (type === 'activity') {
      let diagram = 'flowchart TD\n';

      // Simple activity flow
      diagram += '  Start([Start])\n';
      
      parsed.elements.forEach((e, i) => {
        const next = i < parsed.elements.length - 1 ? parsed.elements[i + 1].name : 'End';
        
        if (e.type === 'decision') {
          diagram += `  ${e.name}{${e.name}}\n`;
          diagram += `  ${e.name} -->|Yes| ${next}\n`;
          diagram += `  ${e.name} -->|No| ${next}\n`;
        } else {
          diagram += `  ${e.name}[${e.name}]\n`;
          diagram += `  ${e.name} --> ${next}\n`;
        }
      });

      diagram += '  End([End])\n';
      return diagram;
    }

    return '';
  }

  generatePlantUML(parsed, type, options) {
    // Similar to mermaid but PlantUML syntax
    return `@startuml\n!theme plain\n\n' PlantUML diagram generation\n' Type: ${type}\n\n@enduml`;
  }

  extractBody(source, startIndex) {
    let depth = 1;
    let i = startIndex;
    
    while (depth > 0 && i < source.length) {
      if (source[i] === '{') depth++;
      if (source[i] === '}') depth--;
      i++;
    }
    
    return source.substring(startIndex, i - 1);
  }

  findEnclosingClass(source, position) {
    const before = source.substring(0, position);
    const classMatch = before.match(/class\s+(\w+)[^{]*$/);
    return classMatch ? classMatch[1] : null;
  }
}

module.exports = { UMLTool };
