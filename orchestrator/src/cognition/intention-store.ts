import type Database from "better-sqlite3";
import type { Intention } from "./intention-types.js";

export class IntentionStore {
  constructor(private readonly db: Database.Database) {}

  upsert(intention: Intention): void {
    const stmt = this.db.prepare(`
      INSERT INTO cognition_intentions
        (site, name, args_schema, requires_state, steps_json, verify_json, failure_modes_json, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (site, name) DO UPDATE SET
        args_schema = excluded.args_schema,
        requires_state = excluded.requires_state,
        steps_json = excluded.steps_json,
        verify_json = excluded.verify_json,
        failure_modes_json = excluded.failure_modes_json,
        description = excluded.description,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      intention.site,
      intention.name,
      JSON.stringify(intention.args_schema),
      intention.requires_state ?? null,
      JSON.stringify(intention.steps),
      JSON.stringify(intention.verify),
      JSON.stringify(intention.failure_modes),
      intention.description ?? null,
      intention.created_at,
      intention.updated_at,
    );
  }

  get(site: string, name: string): Intention | null {
    const row = this.db.prepare(
      `SELECT * FROM cognition_intentions WHERE site = ? AND name = ?`
    ).get(site, name) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.deserialize(row);
  }

  list(site: string): Intention[] {
    const rows = this.db.prepare(
      `SELECT * FROM cognition_intentions WHERE site = ? ORDER BY name ASC`
    ).all(site) as Array<Record<string, unknown>>;
    return rows.map((r) => this.deserialize(r));
  }

  remove(site: string, name: string): boolean {
    const result = this.db.prepare(
      `DELETE FROM cognition_intentions WHERE site = ? AND name = ?`
    ).run(site, name);
    return result.changes > 0;
  }

  private deserialize(row: Record<string, unknown>): Intention {
    return {
      site: row.site as string,
      name: row.name as string,
      args_schema: JSON.parse(row.args_schema as string),
      requires_state: (row.requires_state as string | null) ?? undefined,
      steps: JSON.parse(row.steps_json as string),
      verify: JSON.parse(row.verify_json as string),
      failure_modes: JSON.parse(row.failure_modes_json as string),
      description: (row.description as string | null) ?? undefined,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}
