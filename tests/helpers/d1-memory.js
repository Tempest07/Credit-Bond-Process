import { DatabaseSync } from 'node:sqlite';

export function createMemoryD1() {
  const sql = new DatabaseSync(':memory:');
  const statements = [];
  let failure = '';
  function prepare(query) {
    statements.push(query);
    const make = bindings => ({
      bind: (...values) => make(values),
      execute() {
        if (failure && query.includes(failure)) throw new Error('private-database-failure');
        const statement = sql.prepare(query);
        if (statement.columns().length) return { success: true, results: statement.all(...bindings).map(row => ({ ...row })), meta: { changes: 0 } };
        return { success: true, results: [], meta: { changes: Number(statement.run(...bindings).changes) } };
      },
      async run() { return this.execute(); },
      async first() { return this.execute().results[0] || null; },
    });
    return make([]);
  }
  return { sql, statements, prepare, setFail(value) { failure = value; },
    async batch(batch) {
      sql.exec('BEGIN');
      try { const results = batch.map(statement => statement.execute()); sql.exec('COMMIT'); return results; }
      catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
  };
}
