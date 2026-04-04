---
title: SQL Editor
---

The SQL editor is the core of dblumi. It supports PostgreSQL, MySQL, and Oracle with syntax highlighting, auto-complete, and real-time result streaming.

## Key features

- **Syntax highlighting** for PostgreSQL, MySQL, and Oracle SQL
- **Auto-complete** for table names, column names, and SQL keywords
- **Run selection** — select part of a query and run only that
- **Streaming results** — rows appear as they come, no waiting for the full result set
- **Query history** — every executed query is saved and accessible from the Overview
- **Export results** — download as CSV, JSON, or SQL

## Safety guardrails

dblumi detects potentially destructive queries and warns you before execution:

| Level | Color | Examples |
|-------|-------|---------|
| 1 | Blue | INSERT, UPDATE, DELETE |
| 2 | Yellow | Bulk updates without WHERE |
| 3 | Orange | DROP, TRUNCATE |
| 4 | Red | DROP DATABASE, DROP SCHEMA |

You must explicitly confirm before a flagged query runs.