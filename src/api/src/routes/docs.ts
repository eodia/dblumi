import { Hono } from 'hono'
import { swaggerUI } from '@hono/swagger-ui'

// ─── OpenAPI 3.0 spec ────────────────────────────────────────────────────────

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'dblumi API',
    version: '1.0.0',
    description:
      'REST API for dblumi — multi-database SQL client.\n\n' +
      '**Authentication:** Call `POST /api/v1/auth/login`, copy the `token` from the response, ' +
      'then click **Authorize** (🔒) and paste it.',
  },
  servers: [{ url: '/', description: 'Current server' }],
  tags: [
    { name: 'Health', description: 'API health' },
    { name: 'Auth', description: 'Authentication and session' },
    { name: 'Connections', description: 'Database connections' },
    { name: 'Query', description: 'SQL query execution (SSE streaming)' },
    { name: 'Saved Queries', description: 'Saved queries' },
    { name: 'Copilot', description: 'AI SQL assistant (SSE streaming)' },
    { name: 'Sharing', description: 'Sharing and groups' },
    { name: 'Settings', description: 'Instance settings' },
    { name: 'Admin', description: 'Administration — admin role required' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT obtained from POST /api/v1/auth/login (`token` field)',
      },
    },
    schemas: {
      Problem: {
        type: 'object',
        description: 'RFC 7231 Problem Details',
        properties: {
          type: { type: 'string', example: 'https://dblumi.dev/errors/404' },
          title: { type: 'string', example: 'Not found' },
          status: { type: 'integer', example: 404 },
          detail: { type: 'string', example: 'Additional context' },
        },
        required: ['type', 'title', 'status'],
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
          language: { type: 'string', enum: ['fr', 'en'] },
          avatarUrl: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Connection: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          driver: { type: 'string', enum: ['postgresql', 'mysql', 'oracle'] },
          host: { type: 'string' },
          port: { type: 'integer' },
          database: { type: 'string' },
          username: { type: 'string' },
          ssl: { type: 'boolean' },
          color: { type: 'string', nullable: true },
          environment: { type: 'string', nullable: true },
        },
      },
      ConnectionInput: {
        type: 'object',
        required: ['name', 'driver', 'host', 'port', 'username', 'password'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          driver: { type: 'string', enum: ['postgresql', 'mysql', 'oracle'] },
          host: { type: 'string' },
          port: { type: 'integer', minimum: 1, maximum: 65535 },
          database: { type: 'string', default: '' },
          username: { type: 'string' },
          password: { type: 'string' },
          ssl: { type: 'boolean', default: false },
          color: { type: 'string' },
          environment: { type: 'string', maxLength: 50 },
        },
      },
      SavedQuery: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          sql: { type: 'string' },
          description: { type: 'string', nullable: true },
          connectionId: { type: 'string', format: 'uuid', nullable: true },
          folder: { type: 'string', nullable: true },
          sortOrder: { type: 'integer', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      SavedQueryInput: {
        type: 'object',
        required: ['name', 'sql'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          sql: { type: 'string', minLength: 1, maxLength: 100000 },
          description: { type: 'string', maxLength: 1000 },
          connectionId: { type: 'string', format: 'uuid' },
          folder: { type: 'string', maxLength: 100, nullable: true },
          sortOrder: { type: 'integer', nullable: true },
        },
      },
      Group: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    // ── Health ────────────────────────────────────────────────────────────────
    '/api/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        security: [],
        responses: {
          '200': { description: 'API is up', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' } } } } } },
        },
      },
    },

    // ── Auth ──────────────────────────────────────────────────────────────────
    '/api/v1/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  name: { type: 'string', minLength: 1, maxLength: 100 },
                  language: { type: 'string', enum: ['fr', 'en'] },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Account created', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' }, token: { type: 'string' } } } } } },
          '409': { description: 'Email already in use', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Logged in — token is also set as an HttpOnly cookie', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' }, token: { type: 'string' } } } } } },
          '401': { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Log out (revokes the token)',
        security: [],
        responses: {
          '200': { description: 'Logged out', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current user profile',
        responses: {
          '200': { description: 'Profile', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/auth/language': {
      patch: {
        tags: ['Auth'],
        summary: 'Update preferred language',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['language'], properties: { language: { type: 'string', enum: ['fr', 'en'] } } } } },
        },
        responses: {
          '200': { description: 'Language updated', content: { 'application/json': { schema: { type: 'object', properties: { language: { type: 'string' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/auth/ws-token': {
      get: {
        tags: ['Auth'],
        summary: 'Get JWT for WebSocket (HttpOnly cookie → JSON)',
        responses: {
          '200': { description: 'Token', content: { 'application/json': { schema: { type: 'object', properties: { token: { type: 'string' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Connections ────────────────────────────────────────────────────────────
    '/api/v1/connections': {
      get: {
        tags: ['Connections'],
        summary: 'List connections',
        responses: {
          '200': { description: 'List', content: { 'application/json': { schema: { type: 'object', properties: { connections: { type: 'array', items: { $ref: '#/components/schemas/Connection' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      post: {
        tags: ['Connections'],
        summary: 'Create a connection',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ConnectionInput' } } } },
        responses: {
          '201': { description: 'Connection created', content: { 'application/json': { schema: { type: 'object', properties: { connection: { $ref: '#/components/schemas/Connection' } } } } } },
          '400': { description: 'Invalid input', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/connections/test-raw': {
      post: {
        tags: ['Connections'],
        summary: 'Test a connection without saving it',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ConnectionInput' } } } },
        responses: {
          '200': { description: 'Test result', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/connections/{id}': {
      get: {
        tags: ['Connections'],
        summary: 'Get a connection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Connection', content: { 'application/json': { schema: { type: 'object', properties: { connection: { $ref: '#/components/schemas/Connection' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      put: {
        tags: ['Connections'],
        summary: 'Update a connection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ConnectionInput' } } } },
        responses: {
          '200': { description: 'Connection updated', content: { 'application/json': { schema: { type: 'object', properties: { connection: { $ref: '#/components/schemas/Connection' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      delete: {
        tags: ['Connections'],
        summary: 'Delete a connection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/connections/{id}/test': {
      post: {
        tags: ['Connections'],
        summary: 'Test a saved connection',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Test result', content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean' }, message: { type: 'string' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/connections/{id}/schema': {
      get: {
        tags: ['Connections'],
        summary: 'Fetch database schema (tables, columns)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Schema', content: { 'application/json': { schema: { type: 'object', properties: { schema: { type: 'object' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/connections/{id}/table-count': {
      post: {
        tags: ['Connections'],
        summary: 'Get row count for a table',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['table'], properties: { table: { type: 'string' }, schema: { type: 'string' } } },
            },
          },
        },
        responses: {
          '200': { description: 'Row count', content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Query ─────────────────────────────────────────────────────────────────
    '/api/v1/query': {
      post: {
        tags: ['Query'],
        summary: 'Execute a SQL query',
        description:
          'Returns a **Server-Sent Events** stream. Events:\n' +
          '- `columns` — column list\n' +
          '- `rows` — batch of rows\n' +
          '- `done` — query complete (rowCount, duration)\n' +
          '- `error` — SQL error\n' +
          '- `guardrail` — query blocked by guardrail (resend with `force: true` to confirm)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['connectionId', 'sql'],
                properties: {
                  connectionId: { type: 'string', format: 'uuid' },
                  sql: { type: 'string', minLength: 1, maxLength: 100000 },
                  limit: { type: 'integer', minimum: 1, maximum: 10000, default: 1000 },
                  offset: { type: 'integer', minimum: 0, default: 0 },
                  force: { type: 'boolean', default: false, description: 'Bypass guardrail after user confirmation' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'SSE stream', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Connection not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '422': { description: 'Guardrail triggered', content: { 'application/json': { schema: { type: 'object', properties: { type: { type: 'string' }, level: { type: 'integer' }, message: { type: 'string' } } } } } },
        },
      },
    },

    // ── Saved Queries ─────────────────────────────────────────────────────────
    '/api/v1/saved-queries': {
      get: {
        tags: ['Saved Queries'],
        summary: 'List saved queries',
        responses: {
          '200': { description: 'List', content: { 'application/json': { schema: { type: 'object', properties: { savedQueries: { type: 'array', items: { $ref: '#/components/schemas/SavedQuery' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      post: {
        tags: ['Saved Queries'],
        summary: 'Create a saved query',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SavedQueryInput' } } } },
        responses: {
          '201': { description: 'Created', content: { 'application/json': { schema: { type: 'object', properties: { savedQuery: { $ref: '#/components/schemas/SavedQuery' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/reorder': {
      patch: {
        tags: ['Saved Queries'],
        summary: 'Reorder saved queries',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items'],
                properties: { items: { type: 'array', items: { type: 'object', required: ['id', 'sortOrder'], properties: { id: { type: 'string', format: 'uuid' }, sortOrder: { type: 'integer' } } } } },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Reordered', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/{id}': {
      get: {
        tags: ['Saved Queries'],
        summary: 'Get a saved query',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Saved query', content: { 'application/json': { schema: { type: 'object', properties: { savedQuery: { $ref: '#/components/schemas/SavedQuery' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      put: {
        tags: ['Saved Queries'],
        summary: 'Update a saved query',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/SavedQueryInput' } } } },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { savedQuery: { $ref: '#/components/schemas/SavedQuery' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      delete: {
        tags: ['Saved Queries'],
        summary: 'Delete a saved query',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/{id}/shares': {
      get: {
        tags: ['Saved Queries'],
        summary: 'Get shares for a query',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Shares', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      put: {
        tags: ['Saved Queries'],
        summary: 'Update shares for a query',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  userIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                  groupIds: { type: 'array', items: { type: 'string', format: 'uuid' } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Shares updated', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/{id}/versions': {
      get: {
        tags: ['Saved Queries'],
        summary: 'List version history',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Versions', content: { 'application/json': { schema: { type: 'object', properties: { versions: { type: 'array', items: { type: 'object' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/{id}/versions/{versionId}': {
      patch: {
        tags: ['Saved Queries'],
        summary: 'Update a version label',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'versionId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { label: { type: 'string' } } } } } },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/saved-queries/{id}/messages': {
      get: {
        tags: ['Saved Queries'],
        summary: 'Get collaboration message history',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Messages', content: { 'application/json': { schema: { type: 'object', properties: { messages: { type: 'array', items: { type: 'object' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Copilot ───────────────────────────────────────────────────────────────
    '/api/v1/copilot': {
      post: {
        tags: ['Copilot'],
        summary: 'Generate SQL with AI',
        description: 'Returns a **Server-Sent Events** stream with the generated SQL token by token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['prompt'],
                properties: {
                  prompt: { type: 'string' },
                  connectionId: { type: 'string', format: 'uuid' },
                  currentSql: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'SSE stream (SQL tokens)', content: { 'text/event-stream': { schema: { type: 'string' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '503': { description: 'Copilot not configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Sharing ───────────────────────────────────────────────────────────────
    '/api/v1/sharing/groups': {
      get: {
        tags: ['Sharing'],
        summary: 'Groups accessible by the current user',
        responses: {
          '200': { description: 'Groups', content: { 'application/json': { schema: { type: 'object', properties: { groups: { type: 'array', items: { $ref: '#/components/schemas/Group' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/sharing/users': {
      get: {
        tags: ['Sharing'],
        summary: 'All users (for sharing)',
        responses: {
          '200': { description: 'Users', content: { 'application/json': { schema: { type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    '/api/v1/settings/auth-providers': {
      get: {
        tags: ['Settings'],
        summary: 'Enabled authentication providers',
        responses: {
          '200': { description: 'Providers', content: { 'application/json': { schema: { type: 'object', properties: { keycloak: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/settings/copilot-info': {
      get: {
        tags: ['Settings'],
        summary: 'Active AI provider and model',
        responses: {
          '200': { description: 'Copilot info', content: { 'application/json': { schema: { type: 'object', properties: { provider: { type: 'string' }, model: { type: 'string' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },

    // ── Admin ─────────────────────────────────────────────────────────────────
    '/api/v1/admin/users': {
      get: {
        tags: ['Admin'],
        summary: 'List all users',
        description: '**Admin** role required.',
        responses: {
          '200': { description: 'Users', content: { 'application/json': { schema: { type: 'object', properties: { users: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden (admin required)', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/admin/users/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Update a user',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 100 },
                  role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Delete a user',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/admin/groups': {
      get: {
        tags: ['Admin'],
        summary: 'List all groups',
        description: '**Admin** role required.',
        responses: {
          '200': { description: 'Groups', content: { 'application/json': { schema: { type: 'object', properties: { groups: { type: 'array', items: { $ref: '#/components/schemas/Group' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      post: {
        tags: ['Admin'],
        summary: 'Create a group',
        description: '**Admin** role required.',
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name'], properties: { name: { type: 'string', minLength: 1, maxLength: 100 } } } } } },
        responses: {
          '201': { description: 'Group created', content: { 'application/json': { schema: { type: 'object', properties: { group: { $ref: '#/components/schemas/Group' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/admin/groups/{id}': {
      patch: {
        tags: ['Admin'],
        summary: 'Update a group',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } } },
        responses: {
          '200': { description: 'Updated', content: { 'application/json': { schema: { type: 'object', properties: { group: { $ref: '#/components/schemas/Group' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      delete: {
        tags: ['Admin'],
        summary: 'Delete a group',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Deleted', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/admin/groups/{id}/members': {
      get: {
        tags: ['Admin'],
        summary: 'List group members',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          '200': { description: 'Members', content: { 'application/json': { schema: { type: 'object', properties: { members: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
      post: {
        tags: ['Admin'],
        summary: 'Add a member to a group',
        description: '**Admin** role required.',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } } } } },
        responses: {
          '201': { description: 'Member added', content: { 'application/json': { schema: { type: 'object' } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
    '/api/v1/admin/groups/{id}/members/{userId}': {
      delete: {
        tags: ['Admin'],
        summary: 'Remove a member from a group',
        description: '**Admin** role required.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Removed', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' } } } } } },
          '401': { description: 'Unauthenticated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } },
        },
      },
    },
  },
} as const

// ─── Router ──────────────────────────────────────────────────────────────────

const docsRouter = new Hono()

docsRouter.get('/openapi.json', (c) => c.json(spec))
docsRouter.get('/', swaggerUI({ url: '/api/docs/openapi.json' }))

export { docsRouter }
