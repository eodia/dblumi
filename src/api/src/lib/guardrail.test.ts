import { describe, it, expect } from 'vitest'
import { detectGuardrail } from './guardrail.js'

const level = (sql: string, driver = 'postgresql') => detectGuardrail(sql, driver).level

describe('detectGuardrail', () => {
  it('keeps reads at level 0', () => {
    expect(level('SELECT * FROM t')).toBe(0)
    expect(level('WITH a AS (SELECT 1) SELECT * FROM a')).toBe(0)
    expect(level('EXPLAIN SELECT * FROM t')).toBe(0)
  })

  it('ignores keywords inside literals and comments', () => {
    expect(level("SELECT * FROM notes WHERE body = 'drop table users'")).toBe(0)
    expect(level("SELECT * FROM audit WHERE action = 'DELETE'")).toBe(0)
    expect(level('SELECT 1 -- TRUNCATE t')).toBe(0)
    expect(level('SELECT $$DROP DATABASE x$$')).toBe(0)
  })

  it('judges a statement hidden behind a comment on its own keyword', () => {
    expect(level('-- harmless\nGRANT ALL ON t TO public')).toBe(1)
    expect(level('/* note */ DROP TABLE t')).toBe(3)
  })

  it('returns the worst level of a multi-statement batch', () => {
    expect(level('SELECT 1; DROP TABLE t')).toBe(3)
    expect(level('SELECT 1; DROP DATABASE prod')).toBe(4)
  })

  it('does not mistake FOR UPDATE or ON CONFLICT DO UPDATE for an UPDATE without WHERE', () => {
    expect(level('SELECT * FROM t WHERE id = 1 FOR UPDATE')).toBe(0)
    expect(level('INSERT INTO t (id) VALUES (1) ON CONFLICT (id) DO UPDATE SET a = 1')).toBe(1)
  })

  it('only counts the WHERE of the statement itself', () => {
    expect(level('UPDATE t SET a = (SELECT max(b) FROM u WHERE u.id = 1)')).toBe(2)
    expect(level('UPDATE t SET a = 1 WHERE id = 2')).toBe(1)
  })

  it('catches Oracle DELETE without FROM, and deletes behind WITH / EXPLAIN ANALYZE', () => {
    expect(level('DELETE emp', 'oracle')).toBe(2)
    expect(level('WITH x AS (SELECT 1) DELETE FROM t')).toBe(2)
    expect(level('EXPLAIN ANALYZE DELETE FROM t')).toBe(2)
  })

  it('still flags DDL and destructive statements', () => {
    expect(level('TRUNCATE t')).toBe(3)
    expect(level('ALTER TABLE t ADD COLUMN c int')).toBe(3)
    expect(level('DROP SCHEMA s CASCADE')).toBe(4)
  })

  it('reads the WHERE hidden behind dialect-specific literals and comments', () => {
    expect(level("DELETE FROM orders # don't touch\nWHERE id = 5", 'mysql')).toBe(1)
    expect(level("DELETE FROM t WHERE name = E'O\\'Brien' AND tenant_id = 42")).toBe(1)
    expect(level("UPDATE t SET note = q'[it's]' WHERE id = 5", 'oracle')).toBe(1)
    expect(level("SELECT q'[DROP TABLE x]' FROM dual", 'oracle')).toBe(0)
  })

  it('treats unknown statements as level 1', () => {
    expect(level('DO $$ BEGIN PERFORM 1; END $$')).toBe(1)
    expect(level('COPY t FROM PROGRAM \'id\'')).toBe(1)
  })

  it('reads SQL Server bracketed identifiers as names, not keywords', () => {
    expect(level('SELECT [drop table], [delete] FROM [update]', 'mssql')).toBe(0)
    expect(level('DELETE FROM [orders]', 'mssql')).toBe(2)
    expect(level('SHUTDOWN WITH NOWAIT', 'mssql')).toBe(4)
  })

  it('only warns about USE where it re-targets a shared client (Trino)', () => {
    expect(level('USE shop', 'mssql')).toBe(0)
    expect(level('USE analytics', 'mysql')).toBe(0)
    expect(level('USE tpch.sf1', 'trino')).toBe(2)
  })

  it('understands Snowflake // comments and stage listings', () => {
    expect(level('SELECT 1 // DROP TABLE t', 'snowflake')).toBe(0)
    expect(level('LIST @my_stage', 'snowflake')).toBe(0)
    expect(level("SELECT 'it\\'s; DROP TABLE t' AS x", 'snowflake')).toBe(0)
  })
})
