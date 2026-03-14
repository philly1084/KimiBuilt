/**
 * SchemaTool - Generate database schemas from entities/descriptions
 */

const { ToolBase } = require('../../ToolBase');

class SchemaTool extends ToolBase {
  constructor() {
    super({
      id: 'schema-generate',
      name: 'Schema Generator',
      description: 'Generate database schemas, DDL, and ORM models from entity definitions',
      category: 'database',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['entities'],
        properties: {
          entities: {
            type: 'array',
            description: 'Entity definitions',
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
                      primary: { type: 'boolean' },
                      unique: { type: 'boolean' },
                      index: { type: 'boolean' },
                      default: {},
                      references: { type: 'string' },
                      description: { type: 'string' }
                    }
                  }
                },
                indexes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      fields: { type: 'array', items: { type: 'string' } },
                      unique: { type: 'boolean' }
                    }
                  }
                }
              }
            }
          },
          database: {
            type: 'string',
            enum: ['postgresql', 'mysql', 'sqlite', 'mongodb', 'dynamodb'],
            default: 'postgresql'
          },
          orm: {
            type: 'string',
            enum: ['prisma', 'sequelize', 'typeorm', 'mongoose', 'none'],
            default: 'none'
          },
          options: {
            type: 'object',
            properties: {
              timestamps: { type: 'boolean', default: true },
              softDelete: { type: 'boolean', default: false },
              snakeCase: { type: 'boolean', default: true }
            }
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          ddl: { type: 'string' },
          ormSchema: { type: 'string' },
          entities: { type: 'array' },
          erDiagram: { type: 'string' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      entities = [],
      database = 'postgresql',
      orm = 'none',
      options = {}
    } = params;

    const { timestamps = true, softDelete = false, snakeCase = true } = options;

    // Generate DDL
    const ddl = this.generateDDL(entities, database, { timestamps, softDelete, snakeCase });

    // Generate ORM schema
    const ormSchema = orm !== 'none' 
      ? this.generateORMSchema(entities, orm, { timestamps, softDelete })
      : null;

    // Generate ER diagram
    const erDiagram = this.generateERDiagram(entities);

    // Generate entity documentation
    const entityDocs = entities.map(e => this.generateEntityDoc(e));

    return {
      ddl,
      ormSchema,
      erDiagram,
      entities: entityDocs,
      database,
      orm
    };
  }

  generateDDL(entities, database, options) {
    const generators = {
      postgresql: this.generatePostgresDDL.bind(this),
      mysql: this.generateMySQLDDL.bind(this),
      sqlite: this.generateSQLiteDDL.bind(this),
      mongodb: this.generateMongoDDL.bind(this)
    };

    const generator = generators[database] || generators.postgresql;
    return generator(entities, options);
  }

  generatePostgresDDL(entities, options) {
    let ddl = '-- Generated PostgreSQL Schema\n\n';

    entities.forEach(entity => {
      const tableName = options.snakeCase 
        ? this.toSnakeCase(entity.name)
        : entity.name;

      ddl += `CREATE TABLE ${tableName} (\n`;

      const columns = [];

      // Fields
      entity.fields.forEach(field => {
        const colName = options.snakeCase ? this.toSnakeCase(field.name) : field.name;
        const colType = this.mapToPostgresType(field.type);
        const constraints = [];

        if (field.primary) constraints.push('PRIMARY KEY');
        if (field.required || field.primary) constraints.push('NOT NULL');
        if (field.unique && !field.primary) constraints.push('UNIQUE');
        if (field.default !== undefined) {
          constraints.push(`DEFAULT ${this.formatDefault(field.default)}`);
        }

        columns.push(`  ${colName} ${colType} ${constraints.join(' ')}`.trim());
      });

      // Timestamps
      if (options.timestamps) {
        columns.push('  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        columns.push('  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      }

      // Soft delete
      if (options.softDelete) {
        columns.push('  deleted_at TIMESTAMP NULL');
      }

      ddl += columns.join(',\n');
      ddl += '\n);\n\n';

      // Indexes
      entity.fields.forEach(field => {
        if (field.index || field.unique) {
          const colName = options.snakeCase ? this.toSnakeCase(field.name) : field.name;
          const indexName = `${tableName}_${colName}_idx`;
          const unique = field.unique ? 'UNIQUE ' : '';
          ddl += `CREATE ${unique}INDEX ${indexName} ON ${tableName} (${colName});\n`;
        }
      });

      // Foreign keys
      entity.fields.forEach(field => {
        if (field.references) {
          const colName = options.snakeCase ? this.toSnakeCase(field.name) : field.name;
          const [refTable, refCol] = field.references.split('.');
          const fkName = `${tableName}_${colName}_fk`;
          ddl += `\nALTER TABLE ${tableName} ADD CONSTRAINT ${fkName}`;
          ddl += ` FOREIGN KEY (${colName}) REFERENCES ${refTable}(${refCol || 'id'});\n`;
        }
      });

      ddl += '\n';
    });

    return ddl;
  }

  generateMySQLDDL(entities, options) {
    let ddl = '-- Generated MySQL Schema\n\n';

    entities.forEach(entity => {
      const tableName = options.snakeCase 
        ? this.toSnakeCase(entity.name)
        : entity.name;

      ddl += `CREATE TABLE ${tableName} (\n`;

      const columns = entity.fields.map(field => {
        const colName = options.snakeCase ? this.toSnakeCase(field.name) : field.name;
        const colType = this.mapToMySQLType(field.type);
        const constraints = [];

        if (field.primary) constraints.push('PRIMARY KEY');
        if (field.required || field.primary) constraints.push('NOT NULL');
        if (field.unique && !field.primary) constraints.push('UNIQUE');
        if (field.default !== undefined) {
          constraints.push(`DEFAULT ${this.formatDefault(field.default)}`);
        }

        return `  ${colName} ${colType} ${constraints.join(' ')}`.trim();
      });

      if (options.timestamps) {
        columns.push('  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
        columns.push('  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
      }

      ddl += columns.join(',\n');
      ddl += '\n);\n\n';
    });

    return ddl;
  }

  generateSQLiteDDL(entities, options) {
    let ddl = '-- Generated SQLite Schema\n\n';

    entities.forEach(entity => {
      const tableName = options.snakeCase 
        ? this.toSnakeCase(entity.name)
        : entity.name;

      ddl += `CREATE TABLE ${tableName} (\n`;

      const columns = entity.fields.map(field => {
        const colName = options.snakeCase ? this.toSnakeCase(field.name) : field.name;
        const colType = this.mapToSQLiteType(field.type);
        const constraints = [];

        if (field.primary) constraints.push('PRIMARY KEY');
        if (field.required) constraints.push('NOT NULL');
        if (field.unique) constraints.push('UNIQUE');

        return `  ${colName} ${colType} ${constraints.join(' ')}`.trim();
      });

      if (options.timestamps) {
        columns.push('  created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
        columns.push('  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
      }

      ddl += columns.join(',\n');
      ddl += '\n);\n\n';
    });

    return ddl;
  }

  generateMongoDDL(entities, options) {
    let ddl = '// Generated MongoDB Schema\n\n';

    entities.forEach(entity => {
      const collectionName = this.toSnakeCase(entity.name) + 's';
      
      ddl += `// ${entity.name} Collection\n`;
      ddl += `db.createCollection("${collectionName}");\n\n`;

      // Validation schema
      const schema = {
        bsonType: 'object',
        required: entity.fields.filter(f => f.required).map(f => f.name),
        properties: {}
      };

      entity.fields.forEach(field => {
        schema.properties[field.name] = {
          bsonType: this.mapToMongoType(field.type),
          description: field.description
        };
      });

      ddl += `db.createCollection("${collectionName}", {\n`;
      ddl += `  validator: {\n`;
      ddl += `    $jsonSchema: ${JSON.stringify(schema, null, 2)}\n`;
      ddl += `  }\n`;
      ddl += `});\n\n`;

      // Indexes
      entity.fields.forEach(field => {
        if (field.index || field.unique) {
          ddl += `db.${collectionName}.createIndex({ ${field.name}: 1 }, { unique: ${!!field.unique} });\n`;
        }
      });

      ddl += '\n';
    });

    return ddl;
  }

  generateORMSchema(entities, orm, options) {
    switch (orm) {
      case 'prisma':
        return this.generatePrismaSchema(entities, options);
      case 'sequelize':
        return this.generateSequelizeSchema(entities, options);
      case 'typeorm':
        return this.generateTypeORMSchema(entities, options);
      case 'mongoose':
        return this.generateMongooseSchema(entities, options);
      default:
        return null;
    }
  }

  generatePrismaSchema(entities, options) {
    let schema = '// Generated Prisma Schema\n\n';
    schema += 'generator client {\n';
    schema += '  provider = "prisma-client-js"\n';
    schema += '}\n\n';
    schema += 'datasource db {\n';
    schema += '  provider = "postgresql"\n';
    schema += '  url      = env("DATABASE_URL")\n';
    schema += '}\n\n';

    entities.forEach(entity => {
      schema += `model ${entity.name} {\n`;

      entity.fields.forEach(field => {
        const type = this.mapToPrismaType(field.type);
        const attrs = [];

        if (field.primary) attrs.push('@id');
        if (field.unique && !field.primary) attrs.push('@unique');
        if (field.default !== undefined) {
          attrs.push(`@default(${this.formatPrismaDefault(field.default)})`);
        }
        if (field.references) {
          const [refModel] = field.references.split('.');
          attrs.push(`@relation(fields: [${field.name}], references: [id])`);
        }

        schema += `  ${field.name} ${type}${field.required || field.primary ? '' : '?'} ${attrs.join(' ')}\n`;
      });

      if (options.timestamps) {
        schema += `  createdAt DateTime @default(now())\n`;
        schema += `  updatedAt DateTime @updatedAt\n`;
      }

      schema += `}\n\n`;
    });

    return schema;
  }

  generateSequelizeSchema(entities, options) {
    let code = '// Generated Sequelize Models\n\n';
    code += "const { DataTypes } = require('sequelize');\n\n";

    entities.forEach(entity => {
      code += `const ${entity.name} = sequelize.define('${entity.name}', {\n`;

      entity.fields.forEach(field => {
        const type = this.mapToSequelizeType(field.type);
        const attrs = [`type: DataTypes.${type}`];

        if (field.primary) attrs.push('primaryKey: true');
        if (field.required) attrs.push('allowNull: false');
        if (field.unique) attrs.push('unique: true');
        if (field.default !== undefined) attrs.push(`defaultValue: ${JSON.stringify(field.default)}`);

        code += `  ${field.name}: { ${attrs.join(', ')} },\n`;
      });

      code += '}, {\n';
      code += `  tableName: '${this.toSnakeCase(entity.name)}s',\n`;
      if (options.timestamps) {
        code += '  timestamps: true,\n';
      }
      code += '});\n\n';
    });

    return code;
  }

  generateTypeORMSchema(entities, options) {
    let code = '// Generated TypeORM Entities\n\n';

    entities.forEach(entity => {
      code += `@Entity('${this.toSnakeCase(entity.name)}s')\n`;
      code += `export class ${entity.name} {\n`;

      entity.fields.forEach(field => {
        const type = this.mapToTypeORMType(field.type);

        if (field.primary) {
          code += `  @PrimaryGeneratedColumn()\n`;
        } else if (field.unique) {
          code += `  @Column({ unique: true })\n`;
        } else {
          code += `  @Column()\n`;
        }

        code += `  ${field.name}: ${type};\n\n`;
      });

      if (options.timestamps) {
        code += `  @CreateDateColumn()\n`;
        code += `  createdAt: Date;\n\n`;
        code += `  @UpdateDateColumn()\n`;
        code += `  updatedAt: Date;\n`;
      }

      code += `}\n\n`;
    });

    return code;
  }

  generateMongooseSchema(entities, options) {
    let code = '// Generated Mongoose Models\n\n';
    code += "const mongoose = require('mongoose');\n\n";

    entities.forEach(entity => {
      const schemaName = entity.name + 'Schema';
      
      code += `const ${schemaName} = new mongoose.Schema({\n`;

      entity.fields.forEach(field => {
        const type = this.mapToMongooseType(field.type);
        const attrs = [type];

        if (field.required) attrs.push(`required: true`);
        if (field.unique) attrs.push(`unique: true`);
        if (field.default !== undefined) attrs.push(`default: ${JSON.stringify(field.default)}`);

        code += `  ${field.name}: { ${attrs.join(', ')} },\n`;
      });

      code += '}, {\n';
      if (options.timestamps) {
        code += '  timestamps: true\n';
      }
      code += '});\n\n';

      code += `module.exports.${entity.name} = mongoose.model('${entity.name}', ${schemaName});\n\n`;
    });

    return code;
  }

  generateERDiagram(entities) {
    let diagram = 'erDiagram\n';

    entities.forEach(entity => {
      const tableName = this.toSnakeCase(entity.name).toUpperCase();
      
      diagram += `    ${tableName} {\n`;
      
      entity.fields.forEach(field => {
        const dbType = this.mapToPostgresType(field.type);
        const key = field.primary ? 'PK' : field.unique ? 'UK' : '';
        diagram += `        ${dbType} ${field.name} ${key}\n`;
      });
      
      diagram += '    }\n';
    });

    // Relationships
    entities.forEach(entity => {
      entity.fields.forEach(field => {
        if (field.references) {
          const [refTable] = field.references.split('.');
          diagram += `    ${this.toSnakeCase(entity.name).toUpperCase()} ||--o{ ${this.toSnakeCase(refTable).toUpperCase()} : references\n`;
        }
      });
    });

    return diagram;
  }

  generateEntityDoc(entity) {
    return {
      name: entity.name,
      description: entity.description,
      fields: entity.fields.length,
      indexes: entity.indexes?.length || 0,
      relationships: entity.fields.filter(f => f.references).length
    };
  }

  // Helper methods

  toSnakeCase(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  }

  mapToPostgresType(type) {
    const mapping = {
      string: 'VARCHAR(255)',
      text: 'TEXT',
      integer: 'INTEGER',
      bigint: 'BIGINT',
      decimal: 'DECIMAL(10,2)',
      float: 'REAL',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'TIMESTAMP',
      json: 'JSONB',
      uuid: 'UUID',
      binary: 'BYTEA'
    };
    return mapping[type] || 'VARCHAR(255)';
  }

  mapToMySQLType(type) {
    const mapping = {
      string: 'VARCHAR(255)',
      text: 'TEXT',
      integer: 'INT',
      bigint: 'BIGINT',
      decimal: 'DECIMAL(10,2)',
      float: 'FLOAT',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'DATETIME',
      json: 'JSON',
      binary: 'BLOB'
    };
    return mapping[type] || 'VARCHAR(255)';
  }

  mapToSQLiteType(type) {
    const mapping = {
      string: 'TEXT',
      text: 'TEXT',
      integer: 'INTEGER',
      bigint: 'INTEGER',
      decimal: 'REAL',
      float: 'REAL',
      boolean: 'INTEGER',
      date: 'TEXT',
      datetime: 'TEXT',
      json: 'TEXT',
      binary: 'BLOB'
    };
    return mapping[type] || 'TEXT';
  }

  mapToMongoType(type) {
    const mapping = {
      string: 'string',
      text: 'string',
      integer: 'int',
      bigint: 'long',
      decimal: 'decimal',
      float: 'double',
      boolean: 'bool',
      date: 'date',
      datetime: 'date',
      json: 'object',
      array: 'array',
      binary: 'binData'
    };
    return mapping[type] || 'string';
  }

  mapToPrismaType(type) {
    const mapping = {
      string: 'String',
      text: 'String',
      integer: 'Int',
      bigint: 'BigInt',
      decimal: 'Decimal',
      float: 'Float',
      boolean: 'Boolean',
      date: 'DateTime',
      datetime: 'DateTime',
      json: 'Json',
      uuid: 'String'
    };
    return mapping[type] || 'String';
  }

  mapToSequelizeType(type) {
    const mapping = {
      string: 'STRING',
      text: 'TEXT',
      integer: 'INTEGER',
      bigint: 'BIGINT',
      decimal: 'DECIMAL(10,2)',
      float: 'FLOAT',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'DATE',
      json: 'JSON'
    };
    return mapping[type] || 'STRING';
  }

  mapToTypeORMType(type) {
    const mapping = {
      string: 'string',
      text: 'string',
      integer: 'number',
      bigint: 'bigint',
      decimal: 'number',
      float: 'number',
      boolean: 'boolean',
      date: 'Date',
      datetime: 'Date',
      json: 'object'
    };
    return mapping[type] || 'string';
  }

  mapToMongooseType(type) {
    const mapping = {
      string: 'String',
      text: 'String',
      integer: 'Number',
      bigint: 'Number',
      decimal: 'Number',
      float: 'Number',
      boolean: 'Boolean',
      date: 'Date',
      datetime: 'Date',
      json: 'Object',
      array: 'Array'
    };
    return mapping[type] || 'String';
  }

  formatDefault(value) {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return value;
  }

  formatPrismaDefault(value) {
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'boolean') return value.toString();
    return value;
  }
}

module.exports = { SchemaTool };
