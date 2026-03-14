# migration-create

Purpose: generate migration scripts from schema diffs.

Use when:
- you have a current schema and target schema
- you need `up` and `down` migration output

Key params:
- `from`
- `to`
- `database`
- `migrationType`
- `name`

Notes:
- Warns on destructive changes like dropped tables/columns.
