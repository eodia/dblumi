import { describe, it, expect } from 'vitest'
import { applySort, buildCountSql, injectLimit, injectOracleLimit, pageWindow } from './query-executor.js'

describe('pageWindow', () => {
  it('pages inside the user LIMIT / OFFSET', () => {
    expect(pageWindow(null, null, 100, 0)).toEqual({ limit: 100, offset: 0 })
    expect(pageWindow(150, null, 100, 100)).toEqual({ limit: 50, offset: 100 })
    expect(pageWindow(null, 10, 20, 40)).toEqual({ limit: 20, offset: 50 })
    expect(pageWindow(50, null, 100, 100)).toEqual({ limit: 0, offset: 100 })
  })

  it('treats the 10000 page size as "no cap" unless the user wrote a LIMIT', () => {
    expect(pageWindow(null, null, 10_000, 0)).toEqual({ limit: null, offset: 0 })
    expect(pageWindow(7, null, 10_000, 0)).toEqual({ limit: 7, offset: 0 })
  })
})

describe('injectLimit (PostgreSQL / MySQL / SQLite)', () => {
  it('appends LIMIT to a plain query and strips the trailing semicolon', () => {
    expect(injectLimit('SELECT * FROM t;', 100)).toBe('SELECT * FROM t\nLIMIT 100')
    expect(injectLimit('SELECT * FROM t', 100, 200)).toBe('SELECT * FROM t\nLIMIT 100 OFFSET 200')
  })

  it('leaves the LIMIT of a subquery or CTE in place', () => {
    expect(injectLimit('SELECT count(*) FROM (SELECT 1 FROM t LIMIT 100) x', 1000)).toBe(
      'SELECT count(*) FROM (SELECT 1 FROM t LIMIT 100) x\nLIMIT 1000',
    )
    expect(injectLimit('WITH top AS (SELECT * FROM t ORDER BY s DESC LIMIT 10) SELECT * FROM top', 1000)).toBe(
      'WITH top AS (SELECT * FROM t ORDER BY s DESC LIMIT 10) SELECT * FROM top\nLIMIT 1000',
    )
  })

  it('never touches LIMIT inside a literal or a comment', () => {
    expect(injectLimit("SELECT * FROM log WHERE msg = 'LIMIT 5 reached'", 100)).toBe(
      "SELECT * FROM log WHERE msg = 'LIMIT 5 reached'\nLIMIT 100",
    )
    expect(injectLimit('SELECT * FROM t -- LIMIT 5', 100)).toBe('SELECT * FROM t\nLIMIT 100')
  })

  it('does not paginate a WITH … INSERT (it would silently cap the insert)', () => {
    const sql = 'WITH src AS (SELECT * FROM a) INSERT INTO archive SELECT * FROM src'
    expect(injectLimit(sql, 1000)).toBe(sql)
  })

  it('paginates a query preceded by a comment', () => {
    expect(injectLimit('-- note\nSELECT * FROM big', 100)).toBe('-- note\nSELECT * FROM big\nLIMIT 100')
  })

  it('keeps the user OFFSET and never pages past the user LIMIT', () => {
    expect(injectLimit('SELECT * FROM t LIMIT 10 OFFSET 20', 100)).toBe('SELECT * FROM t\nLIMIT 10 OFFSET 20')
    expect(injectLimit('SELECT * FROM t LIMIT 1500', 1000, 1000)).toBe('SELECT * FROM t\nLIMIT 500 OFFSET 1000')
    expect(injectLimit('SELECT * FROM t OFFSET 5 LIMIT 10', 100)).toBe('SELECT * FROM t\nLIMIT 10 OFFSET 5')
  })

  it('reads the MySQL "LIMIT offset, count" form correctly', () => {
    expect(injectLimit('SELECT * FROM t LIMIT 10, 20', 100, 0, 'mysql')).toBe('SELECT * FROM t\nLIMIT 20 OFFSET 10')
  })

  it('replaces a pg FETCH FIRST clause instead of adding a conflicting LIMIT', () => {
    expect(injectLimit('SELECT * FROM t FETCH FIRST 5 ROWS ONLY', 100)).toBe('SELECT * FROM t\nLIMIT 5')
  })

  it('runs forms it cannot rewrite as written', () => {
    expect(injectLimit('SELECT * FROM t LIMIT ALL', 100)).toBe('SELECT * FROM t LIMIT ALL')
    expect(injectLimit('SELECT * FROM t LIMIT $1', 100)).toBe('SELECT * FROM t LIMIT $1')
  })

  it('is not fooled by a column named offset or limit', () => {
    expect(injectLimit('SELECT offset, "limit" FROM t', 100)).toBe('SELECT offset, "limit" FROM t\nLIMIT 100')
  })

  it('needs an explicit LIMIT with an unbounded OFFSET on MySQL / SQLite', () => {
    expect(injectLimit('SELECT * FROM t', 10_000, 10_000, 'mysql')).toBe('SELECT * FROM t\nLIMIT 18446744073709551615 OFFSET 10000')
    expect(injectLimit('SELECT * FROM t', 10_000, 10_000, 'sqlite')).toBe('SELECT * FROM t\nLIMIT -1 OFFSET 10000')
    expect(injectLimit('SELECT * FROM t', 10_000, 10_000)).toBe('SELECT * FROM t\nOFFSET 10000')
  })

  it('leaves non-queries alone', () => {
    expect(injectLimit('UPDATE t SET a = 1 WHERE id = 2;', 100)).toBe('UPDATE t SET a = 1 WHERE id = 2')
    expect(injectLimit('EXPLAIN SELECT * FROM t', 100)).toBe('EXPLAIN SELECT * FROM t')
  })

  it('does not treat a MySQL backslash-escaped quote as the end of the literal', () => {
    expect(injectLimit("SELECT * FROM t WHERE a = 'it\\'s LIMIT 3'", 100, 0, 'mysql')).toBe(
      "SELECT * FROM t WHERE a = 'it\\'s LIMIT 3'\nLIMIT 100",
    )
  })
})

describe('never truncates a statement (dialect-specific literals and comments)', () => {
  it('keeps the WHERE after a MySQL # comment', () => {
    const sql = "DELETE FROM orders # don't touch\nWHERE id = 5"
    expect(injectLimit(sql, 100, 0, 'mysql')).toBe(sql)
  })

  it("keeps what follows a PostgreSQL E'…' string", () => {
    const sql = "DELETE FROM t WHERE name = E'O\\'Brien' AND tenant_id = 42"
    expect(injectLimit(sql, 100)).toBe(sql)
    expect(injectLimit("SELECT * FROM t WHERE name = E'O\\'Brien' AND tenant_id = 42", 100)).toBe(
      "SELECT * FROM t WHERE name = E'O\\'Brien' AND tenant_id = 42\nLIMIT 100",
    )
  })

  it("keeps the WHERE after an Oracle q'[…]' literal", () => {
    const sql = "UPDATE t SET note = q'[it's]' WHERE id = 5"
    expect(injectOracleLimit(sql, 100)).toBe(sql)
  })

  it('falls back to the whole text when the end cannot be told apart from a literal', () => {
    // Unterminated for the scanner: nothing may be cut from it.
    expect(injectLimit("UPDATE t SET a = 'x WHERE id = 5;", 100)).toBe("UPDATE t SET a = 'x WHERE id = 5")
  })

  it('still paginates when a column is named offset', () => {
    expect(injectOracleLimit('SELECT * FROM events ORDER BY offset DESC', 50)).toBe(
      'SELECT * FROM events ORDER BY offset DESC\nOFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY',
    )
  })

  it('leaves LIMIT … FOR UPDATE as written', () => {
    expect(injectLimit('SELECT * FROM t LIMIT 5 FOR UPDATE', 100)).toBe('SELECT * FROM t LIMIT 5 FOR UPDATE')
  })
})

describe('injectOracleLimit', () => {
  it('uses OFFSET … FETCH NEXT and pages inside a user FETCH FIRST', () => {
    expect(injectOracleLimit('SELECT * FROM emp', 100)).toBe('SELECT * FROM emp\nOFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY')
    expect(injectOracleLimit('SELECT * FROM emp FETCH FIRST 5 ROWS ONLY', 100)).toBe(
      'SELECT * FROM emp\nOFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY',
    )
    expect(injectOracleLimit('SELECT * FROM emp FETCH FIRST ROW ONLY', 100)).toBe(
      'SELECT * FROM emp\nOFFSET 0 ROWS FETCH NEXT 1 ROWS ONLY',
    )
  })

  it('leaves the FETCH of a subquery in place', () => {
    expect(injectOracleLimit('SELECT * FROM (SELECT * FROM emp FETCH FIRST 3 ROWS ONLY) e', 100)).toBe(
      'SELECT * FROM (SELECT * FROM emp FETCH FIRST 3 ROWS ONLY) e\nOFFSET 0 ROWS FETCH NEXT 100 ROWS ONLY',
    )
  })

  it('keeps the mandatory semicolon of a PL/SQL block', () => {
    expect(injectOracleLimit('BEGIN NULL; END;', 100)).toBe('BEGIN NULL; END;')
  })
})

describe('applySort', () => {
  it('wraps the query and quotes the sort columns per dialect', () => {
    expect(applySort('postgresql', 'SELECT * FROM t;', [{ column: 'Created At', direction: 'desc' }])).toBe(
      'SELECT * FROM (\nSELECT * FROM t\n) AS _s ORDER BY "Created At" DESC',
    )
    expect(applySort('mysql', 'SELECT * FROM t', [{ column: 'a', direction: 'asc' }, { column: 'b`c', direction: 'desc' }])).toBe(
      'SELECT * FROM (\nSELECT * FROM t\n) AS _s ORDER BY `a` ASC, `b``c` DESC',
    )
  })

  it('uses an alias without AS on Oracle (ORA-00933)', () => {
    expect(applySort('oracle', 'SELECT * FROM emp', [{ column: 'ENAME', direction: 'asc' }])).toBe(
      'SELECT * FROM (\nSELECT * FROM emp\n) dblumi_s ORDER BY "ENAME" ASC',
    )
  })

  it('keeps a trailing line comment from swallowing the wrapper', () => {
    expect(applySort('postgresql', 'SELECT 1 AS a -- note', [{ column: 'a', direction: 'asc' }])).toBe(
      'SELECT * FROM (\nSELECT 1 AS a\n) AS _s ORDER BY "a" ASC',
    )
  })

  it('does not wrap statements that are not a single query', () => {
    expect(applySort('postgresql', 'UPDATE t SET a = 1', [{ column: 'a', direction: 'asc' }])).toBe('UPDATE t SET a = 1')
    expect(applySort('postgresql', 'SELECT 1; SELECT 2', [{ column: 'a', direction: 'asc' }])).toBe('SELECT 1; SELECT 2')
  })
})

describe('buildCountSql', () => {
  it('counts a single query, with an Oracle-compatible alias', () => {
    expect(buildCountSql('postgresql', 'SELECT * FROM t;')).toBe('SELECT COUNT(*) AS total FROM (\nSELECT * FROM t\n) AS _cnt')
    expect(buildCountSql('oracle', 'SELECT * FROM emp')).toBe('SELECT COUNT(*) AS "total" FROM (\nSELECT * FROM emp\n) dblumi_cnt')
  })

  it('refuses anything but one read statement', () => {
    expect(buildCountSql('postgresql', 'DELETE FROM t')).toBeNull()
    expect(buildCountSql('postgresql', 'SELECT 1; DROP TABLE t')).toBeNull()
  })
})

describe('SQL Server sort and count', () => {
  const byName = [{ column: 'name', direction: 'desc' as const }]

  it('appends or replaces the ORDER BY instead of wrapping the query', () => {
    expect(applySort('mssql', 'SELECT * FROM dbo.users', byName)).toBe('SELECT * FROM dbo.users\nORDER BY [name] DESC')
    expect(applySort('mssql', 'SELECT * FROM users ORDER BY id;', byName)).toBe('SELECT * FROM users ORDER BY [name] DESC')
  })

  it('wraps TOP / OFFSET queries, whose own ORDER BY picks the rows', () => {
    expect(applySort('mssql', 'SELECT TOP (10) * FROM users ORDER BY id', byName)).toBe(
      'SELECT * FROM (\nSELECT TOP (10) * FROM users ORDER BY id\n) AS _s ORDER BY [name] DESC',
    )
  })

  it('leaves FOR XML, SELECT INTO and windowed CTEs untouched', () => {
    for (const sql of [
      'SELECT id FROM users FOR XML PATH',
      'SELECT * INTO #tmp FROM users',
      'WITH c AS (SELECT * FROM users) SELECT TOP 5 * FROM c',
    ]) {
      expect(applySort('mssql', sql, byName), sql).toBe(sql)
    }
    // A CTE without TOP only gets the ORDER BY appended, which T-SQL accepts.
    expect(applySort('mssql', 'WITH c AS (SELECT 1 AS name) SELECT * FROM c', byName)).toBe(
      'WITH c AS (SELECT 1 AS name) SELECT * FROM c\nORDER BY [name] DESC',
    )
  })

  it('counts with COUNT_BIG and drops an ORDER BY the derived table would reject', () => {
    expect(buildCountSql('mssql', 'SELECT * FROM users ORDER BY id')).toBe('SELECT COUNT_BIG(*) AS total FROM (\nSELECT * FROM users \n) AS _cnt')
    expect(buildCountSql('mssql', 'SELECT TOP 5 * FROM users ORDER BY id')).toBe(
      'SELECT COUNT_BIG(*) AS total FROM (\nSELECT TOP 5 * FROM users ORDER BY id\n) AS _cnt',
    )
    expect(buildCountSql('mssql', 'WITH c AS (SELECT 1 AS x) SELECT * FROM c')).toBeNull()
    expect(buildCountSql('mssql', 'SELECT * INTO #t FROM users')).toBeNull()
  })

  it('does not mistake bracketed identifiers for clauses', () => {
    expect(applySort('mssql', 'SELECT [order by], [top] FROM t', byName)).toBe('SELECT [order by], [top] FROM t\nORDER BY [name] DESC')
  })
})
