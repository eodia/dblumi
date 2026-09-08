---
title: First connection
---

Once dblumi is running, connect it to your database.

## Add a connection

1. Click **New connection** in the sidebar
2. Select your database driver: **PostgreSQL**, **MySQL**, **Oracle**, **SQLite**, or **Trino**
3. Fill in the connection details: host, port, database name, username, password
4. Tag the environment: `prod`, `staging`, `dev`, or `local`
5. Click **Test connection** to verify, then **Save**

For **Trino**, the default port is `8080` and the database field holds the target: `hive` for a catalog, `hive/default` for a catalog and a schema.

The password is optional on Trino — leave it empty for a cluster without authentication. Database user management and data import/sync are not available on Trino connections.

## Connection visibility

By default, a connection is **private** — only you can see it. You can share it with specific users or groups from the connection settings.

![Table browser showing database content with schema sidebar](/dblumi/images/feature-connection.png)

## You're ready

Once connected, you land on the **Overview** page — your dashboard for this database. From there you can open the SQL editor, browse your schema, or jump to a saved query.