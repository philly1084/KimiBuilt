/**
 * APIDesignTool - Design REST/GraphQL APIs with OpenAPI specs
 */

const { ToolBase } = require('../../ToolBase');

class APIDesignTool extends ToolBase {
  constructor() {
    super({
      id: 'api-design',
      name: 'API Designer',
      description: 'Design REST or GraphQL APIs with OpenAPI/GraphQL schema generation',
      category: 'design',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['name', 'resources'],
        properties: {
          name: {
            type: 'string',
            description: 'API name'
          },
          type: {
            type: 'string',
            enum: ['rest', 'graphql', 'grpc'],
            default: 'rest'
          },
          resources: {
            type: 'array',
            description: 'API resources/entities',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                fields: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      type: { type: 'string' },
                      required: { type: 'boolean' },
                      description: { type: 'string' }
                    }
                  }
                },
                operations: {
                  type: 'array',
                  items: { type: 'string', enum: ['create', 'read', 'update', 'delete', 'list'] },
                  default: ['create', 'read', 'update', 'delete', 'list']
                }
              }
            }
          },
          version: {
            type: 'string',
            default: '1.0.0'
          },
          basePath: {
            type: 'string',
            default: '/api/v1'
          },
          authentication: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['none', 'apiKey', 'oauth2', 'jwt', 'basic'] },
              description: { type: 'string' }
            }
          },
          outputFormat: {
            type: 'string',
            enum: ['openapi', 'graphql', 'postman', 'markdown'],
            default: 'openapi'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          spec: { type: 'object' },
          documentation: { type: 'string' },
          endpoints: { type: 'array' },
          schemas: { type: 'object' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      name,
      type = 'rest',
      resources = [],
      version = '1.0.0',
      basePath = '/api/v1',
      authentication = { type: 'jwt' },
      outputFormat = 'openapi'
    } = params;

    let result;

    if (type === 'rest') {
      result = this.generateREST({ name, resources, version, basePath, authentication, outputFormat });
    } else if (type === 'graphql') {
      result = this.generateGraphQL({ name, resources, version });
    } else if (type === 'grpc') {
      result = this.generateGRPC({ name, resources, version });
    }

    return result;
  }

  generateREST(config) {
    const { name, resources, version, basePath, authentication, outputFormat } = config;

    const openapi = {
      openapi: '3.0.0',
      info: {
        title: name,
        version,
        description: `API for ${name}`
      },
      servers: [
        { url: basePath }
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: this.generateSecuritySchemes(authentication)
      }
    };

    const endpoints = [];

    resources.forEach(resource => {
      const resourcePath = `/${resource.name.toLowerCase()}`;
      const itemPath = `${resourcePath}/{id}`;

      // Generate schemas
      openapi.components.schemas[resource.name] = {
        type: 'object',
        properties: this.generateProperties(resource.fields),
        required: resource.fields.filter(f => f.required).map(f => f.name)
      };

      // Generate paths
      if (resource.operations.includes('list')) {
        openapi.paths[resourcePath] = {
          get: {
            summary: `List all ${resource.name}s`,
            operationId: `list${resource.name}s`,
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
              { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } }
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: {
                        data: {
                          type: 'array',
                          items: { $ref: `#/components/schemas/${resource.name}` }
                        },
                        pagination: {
                          type: 'object',
                          properties: {
                            page: { type: 'integer' },
                            limit: { type: 'integer' },
                            total: { type: 'integer' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        };

        endpoints.push({
          method: 'GET',
          path: resourcePath,
          operation: `list${resource.name}s`,
          description: `List all ${resource.name}s`
        });
      }

      if (resource.operations.includes('create')) {
        openapi.paths[resourcePath] = openapi.paths[resourcePath] || {};
        openapi.paths[resourcePath].post = {
          summary: `Create a new ${resource.name}`,
          operationId: `create${resource.name}`,
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${resource.name}` }
              }
            }
          },
          responses: {
            '201': {
              description: 'Created',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${resource.name}` }
                }
              }
            },
            '400': { description: 'Bad Request' }
          }
        };

        endpoints.push({
          method: 'POST',
          path: resourcePath,
          operation: `create${resource.name}`,
          description: `Create a new ${resource.name}`
        });
      }

      if (resource.operations.includes('read')) {
        openapi.paths[itemPath] = {
          get: {
            summary: `Get a ${resource.name} by ID`,
            operationId: `get${resource.name}`,
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string' }
              }
            ],
            responses: {
              '200': {
                description: 'Success',
                content: {
                  'application/json': {
                    schema: { $ref: `#/components/schemas/${resource.name}` }
                  }
                }
              },
              '404': { description: 'Not Found' }
            }
          }
        };

        endpoints.push({
          method: 'GET',
          path: itemPath,
          operation: `get${resource.name}`,
          description: `Get a ${resource.name} by ID`
        });
      }

      if (resource.operations.includes('update')) {
        openapi.paths[itemPath] = openapi.paths[itemPath] || {};
        openapi.paths[itemPath].put = {
          summary: `Update a ${resource.name}`,
          operationId: `update${resource.name}`,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${resource.name}` }
              }
            }
          },
          responses: {
            '200': {
              description: 'Success',
              content: {
                'application/json': {
                  schema: { $ref: `#/components/schemas/${resource.name}` }
                }
              }
            }
          }
        };

        endpoints.push({
          method: 'PUT',
          path: itemPath,
          operation: `update${resource.name}`,
          description: `Update a ${resource.name}`
        });
      }

      if (resource.operations.includes('delete')) {
        openapi.paths[itemPath] = openapi.paths[itemPath] || {};
        openapi.paths[itemPath].delete = {
          summary: `Delete a ${resource.name}`,
          operationId: `delete${resource.name}`,
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '204': { description: 'Deleted' },
            '404': { description: 'Not Found' }
          }
        };

        endpoints.push({
          method: 'DELETE',
          path: itemPath,
          operation: `delete${resource.name}`,
          description: `Delete a ${resource.name}`
        });
      }
    });

    // Add security
    if (authentication.type !== 'none') {
      openapi.security = [
        { [authentication.type]: [] }
      ];
    }

    // Generate documentation
    const documentation = this.generateAPIDocumentation(openapi, endpoints);

    return {
      spec: openapi,
      documentation,
      endpoints,
      schemas: openapi.components.schemas,
      format: 'openapi'
    };
  }

  generateGraphQL(config) {
    const { name, resources, version } = config;

    let schema = `\n# ${name} GraphQL API\n# Version: ${version}\n\n`;

    // Generate types
    resources.forEach(resource => {
      schema += `type ${resource.name} {\n`;
      resource.fields.forEach(field => {
        const required = field.required ? '!' : '';
        const gqlType = this.mapToGraphQLType(field.type);
        schema += `  ${field.name}: ${gqlType}${required}\n`;
      });
      schema += `}\n\n`;

      // Input type
      schema += `input ${resource.name}Input {\n`;
      resource.fields.forEach(field => {
        if (!field.name.endsWith('Id') && !field.name.endsWith('At')) {
          const required = field.required ? '!' : '';
          const gqlType = this.mapToGraphQLType(field.type);
          schema += `  ${field.name}: ${gqlType}${required}\n`;
        }
      });
      schema += `}\n\n`;
    });

    // Generate queries
    schema += `type Query {\n`;
    resources.forEach(resource => {
      if (resource.operations.includes('list')) {
        schema += `  ${resource.name.toLowerCase()}s(page: Int, limit: Int): [${resource.name}]!\n`;
      }
      if (resource.operations.includes('read')) {
        schema += `  ${resource.name.toLowerCase()}(id: ID!): ${resource.name}\n`;
      }
    });
    schema += `}\n\n`;

    // Generate mutations
    schema += `type Mutation {\n`;
    resources.forEach(resource => {
      if (resource.operations.includes('create')) {
        schema += `  create${resource.name}(input: ${resource.name}Input!): ${resource.name}!\n`;
      }
      if (resource.operations.includes('update')) {
        schema += `  update${resource.name}(id: ID!, input: ${resource.name}Input!): ${resource.name}!\n`;
      }
      if (resource.operations.includes('delete')) {
        schema += `  delete${resource.name}(id: ID!): Boolean!\n`;
      }
    });
    schema += `}\n`;

    return {
      spec: { schema },
      documentation: schema,
      endpoints: resources.map(r => ({
        type: r.operations.includes('read') || r.operations.includes('list') ? 'Query' : 'Mutation',
        name: r.name,
        operations: r.operations
      })),
      schemas: {},
      format: 'graphql'
    };
  }

  generateGRPC(config) {
    // Simplified gRPC proto generation
    const { name, resources, version } = config;

    let proto = `syntax = "proto3";\n\n`;
    proto += `package ${name.toLowerCase()}.v${version.split('.')[0]};\n\n`;
    proto += `option go_package = "github.com/example/${name.toLowerCase()}/proto";\n\n`;

    resources.forEach(resource => {
      // Message
      proto += `message ${resource.name} {\n`;
      resource.fields.forEach((field, index) => {
        const protoType = this.mapToProtoType(field.type);
        proto += `  ${protoType} ${field.name} = ${index + 1};\n`;
      });
      proto += `}\n\n`;

      // Service
      proto += `service ${resource.name}Service {\n`;
      if (resource.operations.includes('list')) {
        proto += `  rpc List${resource.name}s(List${resource.name}sRequest) returns (List${resource.name}sResponse);\n`;
      }
      if (resource.operations.includes('read')) {
        proto += `  rpc Get${resource.name}(Get${resource.name}Request) returns (${resource.name});\n`;
      }
      if (resource.operations.includes('create')) {
        proto += `  rpc Create${resource.name}(Create${resource.name}Request) returns (${resource.name});\n`;
      }
      proto += `}\n\n`;
    });

    return {
      spec: { proto },
      documentation: proto,
      endpoints: [],
      schemas: {},
      format: 'protobuf'
    };
  }

  generateProperties(fields) {
    const properties = {};
    fields.forEach(field => {
      properties[field.name] = {
        type: this.mapToOpenAPIType(field.type),
        description: field.description
      };
    });
    return properties;
  }

  generateSecuritySchemes(auth) {
    const schemes = {};

    switch (auth.type) {
      case 'apiKey':
        schemes.apiKey = {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        };
        break;
      case 'oauth2':
        schemes.oauth2 = {
          type: 'oauth2',
          flows: {
            authorizationCode: {
              authorizationUrl: '/oauth/authorize',
              tokenUrl: '/oauth/token',
              scopes: { read: 'Read access', write: 'Write access' }
            }
          }
        };
        break;
      case 'jwt':
        schemes.bearerAuth = {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        };
        break;
      case 'basic':
        schemes.basicAuth = {
          type: 'http',
          scheme: 'basic'
        };
        break;
    }

    return schemes;
  }

  generateAPIDocumentation(openapi, endpoints) {
    return `\n# ${openapi.info.title} API Documentation\n\n## Base URL\n\`\`\`\n${openapi.servers[0].url}\n\`\`\`\n\n## Endpoints\n\n${endpoints.map(e => `### ${e.method} ${e.path}\n${e.description}\n`).join('\n')}\n\n## Authentication\n${openapi.security ? 'This API requires authentication.' : 'No authentication required.'}\n\n## Schemas\n\n${Object.entries(openapi.components.schemas).map(([name, schema]) => `### ${name}\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n`).join('\n')}\n`;
  }

  mapToOpenAPIType(type) {
    const mapping = {
      string: 'string',
      number: 'number',
      integer: 'integer',
      boolean: 'boolean',
      date: 'string',
      datetime: 'string',
      array: 'array',
      object: 'object'
    };
    return mapping[type] || 'string';
  }

  mapToGraphQLType(type) {
    const mapping = {
      string: 'String',
      number: 'Float',
      integer: 'Int',
      boolean: 'Boolean',
      date: 'String',
      datetime: 'String',
      id: 'ID'
    };
    return mapping[type] || 'String';
  }

  mapToProtoType(type) {
    const mapping = {
      string: 'string',
      number: 'double',
      integer: 'int32',
      boolean: 'bool',
      id: 'string'
    };
    return mapping[type] || 'string';
  }
}

module.exports = { APIDesignTool };
