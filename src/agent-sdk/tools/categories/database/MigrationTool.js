/**
 * MigrationTool - Generate and manage database migrations
 */

const { ToolBase } = require('../../ToolBase');

class MigrationTool extends ToolBase {
  constructor() {
    super({
      id: 'migration-create',
      name: 'Migration Generator',
      description: 'Generate database migration scripts from schema changes',
      category: 'database',
      version: '1.0.0',
      backend: {
        sideEffects: [],
        sandbox: {},
        timeout: 60000
      },
      inputSchema: {
        type: 'object',
        required: ['from', 'to'],
        properties: {
          from: {
            type: 'object',
            description: 'Current schema state'
          },
          to: {
            type: 'object',
            description: 'Target schema state'
          },
          database: {
            type: 'string',
            enum: ['postgresql', 'mysql', 'sqlite', 'mongodb'],
            default: 'postgresql'
          },
          migrationType: {
            type: 'string',
            enum: ['sql', 'knex', 'sequelize', 'typeorm', 'prisma'],
            default: 'sql'
          },
          name: {
            type: 'string',
            description: 'Migration name'
          }
        }
      },
      outputSchema: {
        type: 'object',
        properties: {
          up: { type: 'string' },
          down: { type: 'string' },
          changes: { type: 'array' },
          warnings: { type: 'array' }
        }
      }
    });
  }

  async handler(params, context, tracker) {
    const {
      from,
      to,
      database = 'postgresql',
      migrationType = 'sql',
      name = 'migration'
    } = params;

    // Calculate schema diff
    const diff = this.calculateDiff(from, to);

    // Generate migration
    const up = this.generateMigration(diff, 'up', database, migrationType);
    const down = this.generateMigration(diff, 'down', database, migrationType);

    // Generate warnings
    const warnings = this.generateWarnings(diff);

    return {
      up,
      down,
      changes: diff,
      warnings,
      timestamp: Date.now(),
      name: this.generateMigrationName(name)
    };
  }

  calculateDiff(from, to) {
    const changes = [];

    const fromTables = this.normalizeSchema(from);
    const toTables = this.normalizeSchema(to);

    // Find new tables
    for (const [tableName, table] of Object.entries(toTables)) {
      if (!fromTables[tableName]) {
        changes.push({
          type: 'create_table',
          table: tableName,
          columns: table.columns
        });
      } else {
        // Compare columns
        const fromColumns = fromTables[tableName].columns;
        const toColumns = table.columns;

        // New columns
        for (const [colName, col] of Object.entries(toColumns)) {
          if (!fromColumns[colName]) {
            changes.push({
              type: 'add_column',
              table: tableName,
              column: colName,
              definition: col
            });
          } else if (this.columnChanged(fromColumns[colName], col)) {
            changes.push({
              type: 'modify_column',
              table: tableName,
              column: colName,
              from: fromColumns[colName],
              to: col
            });
          }
        }

        // Removed columns
        for (const colName of Object.keys(fromColumns)) {
          if (!toColumns[colName]) {
            changes.push({
              type: 'drop_column',
              table: tableName,
              column: colName
            });
          }
        }

        // Compare indexes
        const fromIndexes = fromTables[tableName].indexes || {};
        const toIndexes = table.indexes || {};

        for (const [idxName, idx] of Object.entries(toIndexes)) {
          if (!fromIndexes[idxName]) {
            changes.push({
              type: 'create_index',
              table: tableName,
              index: idxName,
              definition: idx
            });
          }
        }

        for (const idxName of Object.keys(fromIndexes)) {
          if (!toIndexes[idxName]) {
            changes.push({
              type: 'drop_index',
              table: tableName,
              index: idxName
            });
          }
        }
      }
    }

    // Find removed tables
    for (const tableName of Object.keys(fromTables)) {
      if (!toTables[tableName]) {
        changes.push({
          type: 'drop_table',
          table: tableName
        });
      }
    }

    return changes;
  }

  normalizeSchema(schema) {
    // Normalize various schema formats to a common structure
    if (schema.entities) {
      // From SchemaTool format
      const tables = {};
      schema.entities.forEach(entity => {
        const fields = {};
        entity.fields.forEach(field => {
          fields[field.name] = {
            type: field.type,
            required: field.required,
            default: field.default,
            primary: field.primary,
            unique: field.unique
          };
        });
        tables[entity.name] = { columns: fields };
      });
      return tables;
    }

    return schema.tables || schema;
  }

  columnChanged(from, to) {
    return from.type !== to.type ||
           from.required !== to.required ||
           from.default !== to.default;
  }

  generateMigration(diff, direction, database, type) {
    if (type === 'sql') {
      return this.generateSQLMigration(diff, direction, database);
    } else if (type === 'knex') {
      return this.generateKnexMigration(diff, direction);
    } else if (type === 'sequelize') {
      return this.generateSequelizeMigration(diff, direction);
    } else if (type === 'prisma') {
      return this.generatePrismaMigration(diff);
    }
    return '';
  }

  generateSQLMigration(diff, direction, database) {
    let sql = `-- ${direction.toUpperCase()} Migration\n\n`;

    const changes = direction === 'up' ? diff : [...diff].reverse();

    changes.forEach(change => {
      const statement = direction === 'up' 
        ? this.generateUpStatement(change, database)
        : this.generateDownStatement(change, database);
      
      if (statement) {
        sql += statement + ';\n\n';
      }
    });

    return sql;
  }

  generateUpStatement(change, database) {
    const generators = {
      postgresql: {
        create_table: (c) => `CREATE TABLE ${c.table} (\n${this.generateColumns(c.columns, 'postgresql')}\n)`,
        drop_table: (c) => `DROP TABLE ${c.table}`,
        add_column: (c) => `ALTER TABLE ${c.table} ADD COLUMN ${c.column} ${this.mapType(c.definition.type, 'postgresql')}`,
        drop_column: (c) => `ALTER TABLE ${c.table} DROP COLUMN ${c.column}`,
        modify_column: (c) => `ALTER TABLE ${c.table} ALTER COLUMN ${c.column} TYPE ${this.mapType(c.to.type, 'postgresql')}`,
        create_index: (c) => `CREATE ${c.definition.unique ? 'UNIQUE ' : ''}INDEX ${c.index} ON ${c.table} (${c.definition.fields.join(', ')})`,
        drop_index: (c) => `DROP INDEX ${c.index}`
      }
    };

    const dbGenerators = generators[database] || generators.postgresql;
    const generator = dbGenerators[change.type];
    
    return generator ? generator(change) : `-- Unsupported change: ${change.type}`;
  }

  generateDownStatement(change, database) {
    const generators = {
      postgresql: {
        create_table: (c) => `DROP TABLE ${c.table}`,
        drop_table: (c) => `-- Cannot automatically restore dropped table ${c.table}`,
        add_column: (c) => `ALTER TABLE ${c.table} DROP COLUMN ${c.column}`,
        drop_column: (c) => `-- Cannot automatically restore dropped column ${c.column} from ${c.table}`,
        modify_column: (c) => `ALTER TABLE ${c.table} ALTER COLUMN ${c.column} TYPE ${this.mapType(c.from.type, 'postgresql')}`,
        create_index: (c) => `DROP INDEX ${c.index}`,
        drop_index: (c) => `-- Cannot automatically restore dropped index ${c.index}`
      }
    };

    const dbGenerators = generators[database] || generators.postgresql;
    const generator = dbGenerators[change.type];
    
    return generator ? generator(change) : `-- Unsupported change: ${change.type}`;
  }

  generateKnexMigration(diff, direction) {
    let code = `exports.${direction} = function(knex) {\n  return knex.schema\n`;

    const changes = direction === 'up' ? diff : [...diff].reverse();

    changes.forEach(change => {
      switch (change.type) {
        case 'create_table':
          code += `    .createTable('${change.table}', table => {\n`;
          Object.entries(change.columns).forEach(([name, col]) => {
            if (col.primary) {
              code += `      table.increments('${name}').primary();\n`;
            } else {
              code += `      table.${col.type}('${name}')${col.required ? '.notNullable()' : ''}${col.unique ? '.unique()' : ''};\n`;
            }
          });
          code += `    })\n`;
          break;
        case 'drop_table':
          code += `    .dropTable('${change.table}')\n`;
          break;
        case 'add_column':
          code += `    .table('${change.table}', table => {\n      table.${change.definition.type}('${change.column}')${change.definition.required ? '.notNullable()' : ''};\n    })\n`;
          break;
        case 'drop_column':
          code += `    .table('${change.table}', table => {\n      table.dropColumn('${change.column}');\n    })\n`;
          break;
      }
    });

    code += `;\n};\n`;
    return code;
  }

  generateSequelizeMigration(diff, direction) {
    let code = `module.exports = {\n  ${direction}: async (queryInterface, Sequelize) => {\n`;

    const changes = direction === 'up' ? diff : [...diff].reverse();

    changes.forEach(change => {
      switch (change.type) {
        case 'create_table':
          code += `    await queryInterface.createTable('${change.table}', {\n`;
          Object.entries(change.columns).forEach(([name, col]) => {
            code += `      ${name}: {\n        type: Sequelize.${this.mapToSequelizeType(col.type)}\n      },\n`;
          });
          code += `    });\n`;
          break;
        case 'drop_table':
          code += `    await queryInterface.dropTable('${change.table}');\n`;
          break;
        case 'add_column':
          code += `    await queryInterface.addColumn('${change.table}', '${change.column}', {\n      type: Sequelize.${this.mapToSequelizeType(change.definition.type)}\n    });\n`;
          break;
        case 'drop_column':
          code += `    await queryInterface.removeColumn('${change.table}', '${change.column}');\n`;
          break;
      }
    });

    code += `  }\n};\n`;
    return code;
  }

  generatePrismaMigration(diff) {
    // Prisma uses declarative schema, migration is auto-generated
    return `-- Prisma migrations are generated via 'prisma migrate dev'\n-- Schema changes should be made in schema.prisma`;
  }

  generateWarnings(diff) {
    const warnings = [];

    diff.forEach(change => {
      if (change.type === 'drop_table') {
        warnings.push({
          severity: 'high',
          message: `Table '${change.table}' will be dropped. Data will be lost!`,
          change
        });
      }
      if (change.type === 'drop_column') {
        warnings.push({
          severity: 'high',
          message: `Column '${change.column}' in '${change.table}' will be dropped. Data will be lost!`,
          change
        });
      }
      if (change.type === 'modify_column') {
        warnings.push({
          severity: 'medium',
          message: `Column '${change.column}' in '${change.table}' type changed from ${change.from.type} to ${change.to.type}. Data may be truncated!`,
          change
        });
      }
    });

    return warnings;
  }

  generateMigrationName(name) {
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    return `${timestamp}_${name.toLowerCase().replace(/\s+/g, '_')}`;
  }

  generateColumns(columns, database) {
    return Object.entries(columns)
      .map(([name, col]) => {
        const type = this.mapType(col.type, database);
        const constraints = [];
        if (col.primary) constraints.push('PRIMARY KEY');
        if (col.required) constraints.push('NOT NULL');
        if (col.unique) constraints.push('UNIQUE');
        return `  ${name} ${type} ${constraints.join(' ')}`.trim();
      })
      .join(',\n');
  }

  mapType(type, database) {
    const mappings = {
      postgresql: {
        string: 'VARCHAR(255)',
        text: 'TEXT',
        integer: 'INTEGER',
        bigint: 'BIGINT',
        decimal: 'DECIMAL(10,2)',
        boolean: 'BOOLEAN',
        date: 'DATE',
        datetime: 'TIMESTAMP',
        json: 'JSONB'
      }
    };

    return (mappings[database] || mappings.postgresql)[type] || 'VARCHAR(255)';
  }

  mapToSequelizeType(type) {
    const mapping = {
      string: 'STRING',
      text: 'TEXT',
      integer: 'INTEGER',
      bigint: 'BIGINT',
      decimal: 'DECIMAL(10,2)',
      boolean: 'BOOLEAN',
      date: 'DATE',
      datetime: 'DATE',
      json: 'JSON'
    };
    return mapping[type] || 'STRING';
  }
}

module.exports = { MigrationTool };
