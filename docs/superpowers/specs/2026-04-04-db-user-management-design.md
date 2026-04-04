# DB User Management Design

## Goal

Add a "Users" button in the Project Overview status bar (left of the Latency button) that opens a modal for managing database users and their privileges. Supports MySQL, PostgreSQL, and Oracle with driver-specific privilege schemas.

## Architecture

Single modal `DbUsersModal` + single API router `/api/v1/connections/:id/db-users`. The backend adapts SQL to the connection driver. The frontend conditionally renders privilege sections based on the driver. Errors from the DB are surfaced as toasts with the raw SQL error message.

## Tech Stack

Hono, React, Zustand, React Query, Zod, shadcn/ui (Dialog, Tabs, Checkbox, Slider), lucide-react (Users icon), existing `authMiddleware`, existing `connectionManager`.

---

## UI

### Button placement

In `ConnectionStatusBar` (inside `OverviewPage.tsx`), add a Users button **to the left** of the Latency button, in the right-side `flex` group:

```
[ server version ]          [ 👥 3 ]  [ ↻ 141ms ]
```

- Icon: `Users` (lucide), color `text-indigo-400`
- Badge: numeric count of DB users, fetched on mount via `GET /db-users`
- If count fetch fails (insufficient privileges): badge hidden, button still clickable
- On click: opens `DbUsersModal`

### Modal structure

`Dialog` with `max-w-5xl`, two-column layout inspired by `TimelineModal`:

**Left column (~35%)**
- Table: `User` / `Host` / `Plugin` (MySQL) or `User` / `Attributes` (PG) or `Username` / `Status` (Oracle)
- Row click → selects user, loads privileges into right panel
- "Create user" button at bottom → resets right panel to empty form
- Selected row highlighted

**Right column (~65%)**
- 4 internal tabs:
  1. **Identity** — Username (text), Host (text, MySQL only, default `%`), Password (password input), Confirm Password (password input). Password fields optional on edit — leave blank to keep current.
  2. **Server Privileges** — Checkbox list of global privileges (driver-specific, see below)
  3. **Table Privileges** — Database selector (loaded from connection schema) + Table selector + checkbox list of table-level privileges (driver-specific)
  4. **Advanced** — Driver-specific resource limits (MySQL: 4 fields; PostgreSQL: connection limit; Oracle: profile display)

**Footer (right column)**
- `Save` button → POST (create) or PUT (edit)
- `Drop User` button → `SlideToConfirm` → DELETE

---

## Privilege Schemas

### MySQL

**Server Privileges (global):**
SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, RELOAD, SHUTDOWN, PROCESS, FILE, GRANT OPTION, REFERENCES, INDEX, ALTER, SHOW DATABASES, SUPER, CREATE TEMPORARY TABLES, LOCK TABLES, EXECUTE, REPLICATION SLAVE, REPLICATION CLIENT, CREATE VIEW, SHOW VIEW, CREATE ROUTINE, ALTER ROUTINE, CREATE USER, EVENT, TRIGGER

**Table Privileges:**
SELECT, INSERT, UPDATE, REFERENCES, DELETE, CREATE, DROP, ALTER, INDEX, TRIGGER, CREATE VIEW, SHOW VIEW, GRANT, EXECUTE, ALTER ROUTINE, CREATE ROUTINE, CREATE TEMPORARY TABLES, LOCK TABLES, EVENT

**Advanced:**
- Max queries per hour (`MAX_QUERIES_PER_HOUR`)
- Max updates per hour (`MAX_UPDATES_PER_HOUR`)
- Max connections per hour (`MAX_CONNECTIONS_PER_HOUR`)
- Max user connections (`MAX_USER_CONNECTIONS`)

---

### PostgreSQL

**Server Privileges (role attributes):**
SUPERUSER, CREATEDB, CREATEROLE, LOGIN, REPLICATION, BYPASSRLS

**Table Privileges:**
SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER

**Advanced:**
- Connection limit (`CONNECTION LIMIT`, integer, -1 = unlimited)

Note: Host field not applicable for PostgreSQL — hidden in Identity tab.

---

### Oracle

**Server Privileges (system privileges):**
CREATE SESSION, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE SEQUENCE, CREATE TRIGGER, CREATE TYPE, CREATE USER, DROP ANY TABLE, ALTER ANY TABLE, SELECT ANY TABLE, INSERT ANY TABLE, UPDATE ANY TABLE, DELETE ANY TABLE, GRANT ANY PRIVILEGE, SYSDBA, SYSOPER

**Table Privileges:**
SELECT, INSERT, UPDATE, DELETE, ALTER, INDEX, REFERENCES, EXECUTE

**Advanced:**
- Profile: display current profile name (read-only). Resource limits managed via Oracle profiles, not editable here.

Note: Host field not applicable for Oracle — hidden in Identity tab.

---

## API

Router: `src/api/src/routes/db-users.ts`
Mounted at: `/api/v1/connections/:id/db-users`
Auth: `authMiddleware` on all routes.

| Method | Path | Action |
|--------|------|--------|
| `GET` | `/` | List DB users + count |
| `POST` | `/` | Create user + apply privileges |
| `PUT` | `/:username` | Update password (optional) + privileges |
| `DELETE` | `/:username` | DROP USER |
| `GET` | `/:username/privileges` | Read current privileges for a user |

**Driver SQL:**

- **MySQL**: query `mysql.user`, `CREATE USER`, `GRANT ... ON *.*`, `GRANT ... ON db.table`, `ALTER USER ... WITH MAX_*`, `REVOKE`, `FLUSH PRIVILEGES`
- **PostgreSQL**: query `pg_catalog.pg_user` / `pg_roles`, `CREATE ROLE ... WITH`, `ALTER ROLE`, `GRANT ... ON TABLE ... TO`, `REVOKE`
- **Oracle**: query `dba_users`, `dba_sys_privs`, `dba_tab_privs`, `CREATE USER`, `ALTER USER`, `GRANT ... TO`, `REVOKE`

Error handling: catch SQL errors, return `{ message: rawError }` with status 422. Frontend shows toast with raw message.

---

## Data Flow

1. **Modal opens** → `GET /db-users` → list + count on button badge
2. **User selected** → `GET /db-users/:username/privileges` → pre-fills 4 tabs
3. **Create** → empty form, `POST /db-users` with identity + all privileges in one request
4. **Edit** → `PUT /db-users/:username` — password omitted if fields left blank
5. **Delete** → SlideToConfirm → `DELETE /db-users/:username` → removed from list
6. **SQL error** → toast with raw DB error message

React Query keys:
- `['db-users', connectionId]` — user list
- `['db-user-privileges', connectionId, username]` — per-user privileges

---

## New Files

- `src/api/src/routes/db-users.ts` — Hono router
- `src/web/src/api/db-users.ts` — frontend API client
- `src/web/src/components/overview/DbUsersModal.tsx` — main modal
- `src/web/src/components/overview/DbUsersModal/UserList.tsx` — left panel
- `src/web/src/components/overview/DbUsersModal/UserForm.tsx` — right panel (tabs)
- `src/web/src/components/overview/DbUsersModal/PrivilegeCheckboxList.tsx` — reusable checkbox list

## Modified Files

- `src/api/src/app.ts` — mount db-users router
- `src/web/src/components/overview/OverviewPage.tsx` — add Users button + DbUsersModal
- `src/web/src/i18n/` — add translation keys

---

## Out of Scope

- Role management (PostgreSQL roles assigned to other roles)
- Oracle profile creation/editing
- Privilege templates / presets
- Audit log of changes made via this interface
