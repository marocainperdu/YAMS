'use strict';

/**
 * OpenAPI 3.0 specification for YAMS.
 * Served by swagger-ui-express at GET /api-docs
 */

const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'YAMS — Yet Another Minecraft Server Manager',
    version: '1.0.0',
    description:
      'Local self-hosted REST API for creating, starting, stopping, and monitoring Minecraft server instances.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local dev server' }],

  // Applied to all endpoints. Public endpoints (login, refresh) override with security: [].
  // Only enforced when YAMS_AUTH_ENABLED=true.
  security: [{ bearerAuth: [] }],

  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Access token issued by `POST /auth/login`. ' +
          'Include as: `Authorization: Bearer <token>`. ' +
          'Only enforced when `YAMS_AUTH_ENABLED=true`.',
      },
    },

    schemas: {
      Tokens: {
        type: 'object',
        properties: {
          accessToken:  { type: 'string', description: 'Short-lived JWT (15 min)',         example: 'eyJhbGciOiJIUzI1NiJ9...' },
          refreshToken: { type: 'string', description: 'Long-lived opaque token (7 days)', example: 'a3f8b1c2d4e5...' },
        },
      },
      UserPublic: {
        type: 'object',
        properties: {
          id:       { type: 'string', format: 'uuid' },
          username: { type: 'string', example: 'alice' },
          role:     { type: 'string', enum: ['admin', 'operator', 'user'], example: 'operator' },
        },
      },
      Server: {
        type: 'object',
        properties: {
          id:         { type: 'string', format: 'uuid', example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
          name:       { type: 'string', example: 'survival' },
          path:       { type: 'string', example: 'D:\\CODE\\YAMS\\servers\\survival' },
          port:       { type: 'integer', example: 25565 },
          ram:        { type: 'string', example: '2G' },
          status:     { type: 'string', enum: ['stopped', 'running'], example: 'stopped' },
          pid:        { type: 'integer', nullable: true, example: null },
          created_at: { type: 'string', format: 'date-time', example: '2026-04-09 19:00:00' },
          updated_at: { type: 'string', format: 'date-time', example: '2026-04-09 19:00:00' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Server not found' },
        },
      },

      ErrorWithCode: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Cannot delete the active world' },
          code:  { type: 'string', example: 'ACTIVE_WORLD_PROTECTED' },
        },
      },

      World: {
        type: 'object',
        properties: {
          name:      { type: 'string', example: 'world' },
          active:    { type: 'boolean', example: true,
                       description: 'True when this world matches level-name in server.properties.' },
          size:      { type: 'integer', nullable: true, example: 104857600,
                       description: 'Total byte size computed asynchronously. null until first computation completes.' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true,
                       example: '2026-04-26T12:00:00.000Z' },
        },
      },
    },

    parameters: {
      serverId: {
        name: 'id', in: 'path', required: true,
        description: 'Server UUID',
        schema: { type: 'string', format: 'uuid' },
      },
      worldName: {
        name: 'name', in: 'path', required: true,
        description: 'World directory name (alphanumeric, hyphens, underscores, 1–64 chars)',
        schema: { type: 'string', example: 'world' },
      },
    },
  },

  paths: {
    '/servers': {
      get: {
        summary: 'List all servers',
        operationId: 'listServers',
        responses: {
          200: {
            description: 'Array of server objects',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { $ref: '#/components/schemas/Server' } },
                  },
                },
              },
            },
          },
        },
      },

      post: {
        summary: 'Create a new server',
        operationId: 'createServer',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'port'],
                properties: {
                  name: {
                    type: 'string',
                    description: 'Alphanumeric + hyphens, 3–32 chars, must start with a letter',
                    example: 'survival',
                  },
                  port: {
                    type: 'integer',
                    minimum: 1024,
                    maximum: 65535,
                    example: 25565,
                  },
                  ram: {
                    type: 'string',
                    description: "Memory allocation, e.g. '512M' or '2G'. Defaults to '1G'.",
                    example: '2G',
                    default: '1G',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Server created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Server' } },
                },
              },
            },
          },
          400: {
            description: 'Validation error (invalid name, port, or ram)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
          409: {
            description: 'Port or name already in use',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
              },
            },
          },
        },
      },
    },

    '/servers/{id}': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],

      get: {
        summary: 'Get a single server',
        operationId: 'getServer',
        responses: {
          200: {
            description: 'Server object',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Server' } },
                },
              },
            },
          },
          404: {
            description: 'Server not found',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
        },
      },

      delete: {
        summary: 'Delete a server',
        operationId: 'deleteServer',
        description:
          'Removes the server record from the database and permanently deletes the server directory ' +
          'on disk (all worlds, plugins, logs, etc.). The server must be stopped first (409 SERVER_RUNNING). ' +
          'Directory removal errors are logged but do not fail the request — the DB record is always deleted.',
        responses: {
          204: { description: 'Server deleted — no body' },
          404: {
            description: 'Server not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
          },
          409: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                example: { error: 'Stop the server before deleting it', code: 'SERVER_RUNNING' },
              },
            },
          },
        },
      },
    },

    '/servers/{id}/start': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],

      post: {
        summary: 'Start a server',
        operationId: 'startServer',
        description:
          'Spawns the Minecraft process. Requires `server.jar` to be present in the server directory.',
        responses: {
          200: {
            description: 'Server is now running',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Server' } },
                },
              },
            },
          },
          400: {
            description: 'server.jar not found in the server directory',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Error' } },
            },
          },
          404: { description: 'Server not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Server is already running', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/servers/{id}/stop': {
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ],

      post: {
        summary: 'Stop a running server',
        operationId: 'stopServer',
        description:
          "Sends 'stop' via stdin (graceful Minecraft shutdown). Falls back to process kill if stdin is unavailable.",
        responses: {
          200: {
            description: 'Server is now stopped',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { data: { $ref: '#/components/schemas/Server' } },
                },
              },
            },
          },
          404: { description: 'Server not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: { description: 'Server is not running', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    // ── Worlds ────────────────────────────────────────────────────────────────

    '/servers/{id}/worlds': {
      parameters: [{ $ref: '#/components/parameters/serverId' }],

      get: {
        summary: 'List worlds',
        operationId: 'listWorlds',
        tags: ['Worlds'],
        description:
          'Returns every directory in the server root that contains at least one Minecraft ' +
          'marker file or directory (`level.dat`, `region/`, `data/`, `DIM-1/`, `DIM1/`). ' +
          'System directories (`plugins/`, `mods/`, `logs/`, etc.) are never returned. ' +
          '`active` is `true` for the world currently set in `server.properties` (level-name). ' +
          'If `level-name` points to a non-existent or marker-less directory, no world is active. ' +
          '`size` is `null` on cold cache and populated asynchronously; subsequent requests return the cached value.',
        responses: {
          200: {
            description: 'Array of World objects, active world first then alphabetical',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/World' },
                },
                example: [
                  { name: 'survival', active: true,  size: 52428800,  updatedAt: '2026-04-26T10:00:00.000Z' },
                  { name: 'creative', active: false, size: null,      updatedAt: '2026-04-20T08:30:00.000Z' },
                ],
              },
            },
          },
          404: { description: 'Server not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/servers/{id}/worlds/active': {
      parameters: [{ $ref: '#/components/parameters/serverId' }],

      post: {
        summary: 'Set active world',
        operationId: 'setActiveWorld',
        tags: ['Worlds'],
        description:
          'Updates `level-name` in `server.properties`. The server must be stopped. ' +
          'Two rules apply: if the target directory **does not exist**, the operation is allowed — ' +
          'Minecraft will create it on next start. If the target directory **exists**, it must ' +
          'contain valid Minecraft markers; an existing non-world directory is rejected (400 INVALID_WORLD). ' +
          'Blocked when server is running (409 SERVER_RUNNING).',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {
                    type: 'string',
                    description: 'Target world name (may not exist yet)',
                    example: 'survival',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Active world updated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { active: { type: 'string', example: 'survival' } },
                },
              },
            },
          },
          400: {
            description: 'Invalid world name, or existing directory without Minecraft markers',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  INVALID_WORLD_NAME: { value: { error: 'Invalid world name', code: 'INVALID_WORLD_NAME' } },
                  INVALID_WORLD:      { value: { error: 'Target directory exists but is not a valid Minecraft world', code: 'INVALID_WORLD' } },
                },
              },
            },
          },
          404: { description: 'Server not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                example: { error: 'Server is running', code: 'SERVER_RUNNING' },
              },
            },
          },
        },
      },
    },

    '/servers/{id}/worlds/import': {
      parameters: [{ $ref: '#/components/parameters/serverId' }],

      post: {
        summary: 'Import a world from ZIP',
        operationId: 'importWorld',
        tags: ['Worlds'],
        description:
          'Accepts a `multipart/form-data` request with a `.zip` archive. ' +
          'Two ZIP structures are accepted: **flat** (Minecraft marker files at archive root) and ' +
          '**wrapped** (single root directory containing the world). Multi-root archives are rejected. ' +
          'In wrapped ZIPs, only allowed Minecraft entries are extracted; extra files (README, .git, etc.) ' +
          'are silently ignored. A zip-slip guard rejects any archive with path traversal entries. ' +
          'The world is extracted atomically (temp dir + rename). ' +
          'Blocked when server is running (409 SERVER_RUNNING).',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['world'],
                properties: {
                  world: {
                    type: 'string',
                    format: 'binary',
                    description: 'ZIP archive of the Minecraft world',
                  },
                  name: {
                    type: 'string',
                    description: 'Target world directory name. Defaults to the filename stem of the ZIP.',
                    example: 'my-world',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'World imported successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/World' },
                example: { name: 'my-world', active: false, size: 31457280, updatedAt: '2026-04-27T09:00:00.000Z' },
              },
            },
          },
          400: {
            description: 'Invalid archive (corrupted, zip-slip, ambiguous structure, wrong extension)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  ARCHIVE_CORRUPTED:          { value: { error: 'Archive is corrupted or invalid', code: 'ARCHIVE_CORRUPTED' } },
                  ZIP_SLIP_DETECTED:          { value: { error: 'Unsafe path detected in archive', code: 'ZIP_SLIP_DETECTED' } },
                  AMBIGUOUS_ARCHIVE_STRUCTURE:{ value: { error: 'Archive contains no valid Minecraft world data or has an ambiguous structure', code: 'AMBIGUOUS_ARCHIVE_STRUCTURE' } },
                  MISSING_FILE:               { value: { error: 'Field "world" with a .zip file is required', code: 'MISSING_FILE' } },
                  INVALID_WORLD_NAME:         { value: { error: 'Invalid world name', code: 'INVALID_WORLD_NAME' } },
                },
              },
            },
          },
          404: { description: 'Server not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          409: {
            description: 'World name already exists, or server is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  WORLD_ALREADY_EXISTS: { value: { error: 'A world with this name already exists', code: 'WORLD_ALREADY_EXISTS' } },
                  SERVER_RUNNING:       { value: { error: 'Server is running', code: 'SERVER_RUNNING' } },
                },
              },
            },
          },
          413: {
            description: 'Archive exceeds the size limit (default 2 GB, env WORLD_IMPORT_MAX_SIZE_MB)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                example: { error: 'Archive exceeds the allowed size limit', code: 'IMPORT_TOO_LARGE' },
              },
            },
          },
          500: { description: 'Unexpected server error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/servers/{id}/worlds/{name}': {
      parameters: [
        { $ref: '#/components/parameters/serverId' },
        { $ref: '#/components/parameters/worldName' },
      ],

      get: {
        summary: 'Get world details',
        operationId: 'getWorld',
        tags: ['Worlds'],
        description: 'Returns details for a single world. Returns 404 if the directory does not exist or has no Minecraft markers.',
        responses: {
          200: {
            description: 'World object',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/World' },
                example: { name: 'survival', active: true, size: 52428800, updatedAt: '2026-04-26T10:00:00.000Z' },
              },
            },
          },
          400: {
            description: 'Invalid world name (path traversal, blacklisted name, etc.)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' },
              example: { error: 'Invalid world name', code: 'INVALID_WORLD_NAME' } } },
          },
          404: {
            description: 'Server not found, or world not found / has no Minecraft markers',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' },
              examples: {
                SERVER_NOT_FOUND: { value: { error: 'Server not found', code: 'SERVER_NOT_FOUND' } },
                WORLD_NOT_FOUND:  { value: { error: 'World not found',  code: 'WORLD_NOT_FOUND'  } },
              },
            } },
          },
        },
      },

      delete: {
        summary: 'Delete a world',
        operationId: 'deleteWorld',
        tags: ['Worlds'],
        description:
          'Permanently removes the world directory and its contents. ' +
          'Cannot delete the currently active world (409 ACTIVE_WORLD_PROTECTED). ' +
          'Blocked when server is running (409 SERVER_RUNNING). ' +
          'Symlinked directories are rejected (400 SYMLINK_FORBIDDEN).',
        responses: {
          204: { description: 'World deleted — no body' },
          400: {
            description: 'Invalid world name or symlink',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  INVALID_WORLD_NAME:  { value: { error: 'Invalid world name',              code: 'INVALID_WORLD_NAME'  } },
                  SYMLINK_FORBIDDEN:   { value: { error: 'Symlink worlds are not allowed',   code: 'SYMLINK_FORBIDDEN'   } },
                },
              },
            },
          },
          404: {
            description: 'Server or world not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } },
          },
          409: {
            description: 'Active world protection or server is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  ACTIVE_WORLD_PROTECTED: { value: { error: 'Cannot delete the active world', code: 'ACTIVE_WORLD_PROTECTED' } },
                  SERVER_RUNNING:         { value: { error: 'Server is running',               code: 'SERVER_RUNNING'         } },
                },
              },
            },
          },
        },
      },
    },

    '/servers/{id}/worlds/{name}/export': {
      parameters: [
        { $ref: '#/components/parameters/serverId' },
        { $ref: '#/components/parameters/worldName' },
      ],

      get: {
        summary: 'Export world as ZIP',
        operationId: 'exportWorld',
        tags: ['Worlds'],
        description:
          'Streams the world directory as a ZIP archive. The world is placed at the root of the ' +
          'archive (entries start with `{name}/`). `.lock` files are excluded. ' +
          '**The server must be stopped before exporting** (409 SERVER_RUNNING). ' +
          'If a streaming error occurs after headers are sent, the connection is closed abruptly ' +
          '(the client receives a truncated ZIP rather than a JSON error).',
        responses: {
          200: {
            description: 'ZIP archive stream',
            content: {
              'application/zip': {
                schema: { type: 'string', format: 'binary' },
              },
            },
            headers: {
              'Content-Disposition': {
                description: 'Attachment filename: `{name}-export-{YYYY-MM-DD}.zip`',
                schema: { type: 'string', example: 'attachment; filename="survival-export-2026-04-27.zip"' },
              },
            },
          },
          400: {
            description: 'Invalid world name or symlink',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                examples: {
                  INVALID_WORLD_NAME: { value: { error: 'Invalid world name',            code: 'INVALID_WORLD_NAME' } },
                  SYMLINK_FORBIDDEN:  { value: { error: 'Symlink worlds are not allowed', code: 'SYMLINK_FORBIDDEN'  } },
                },
              },
            },
          },
          404: {
            description: 'Server or world not found',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } },
          },
          409: {
            description: 'Server is running',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorWithCode' },
                example: { error: 'Stop the server before exporting a world', code: 'SERVER_RUNNING' },
              },
            },
          },
        },
      },
    },

    // ── Auth ─────────────────────────────────────────────────────────────────

    '/auth/login': {
      post: {
        summary: 'Log in and obtain tokens',
        operationId: 'login',
        tags: ['Auth'],
        security: [],
        description:
          'Validates credentials and returns a short-lived access token (15 min) and a long-lived ' +
          'refresh token (7 days). Rate-limited to 10 requests per 15 min per IP.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', example: 'admin' },
                  password: { type: 'string', format: 'password', example: 'changeme' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/Tokens' },
                    user: { $ref: '#/components/schemas/UserPublic' },
                  },
                },
              },
            },
          },
          400: { description: 'Missing username or password', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/refresh': {
      post: {
        summary: 'Refresh access token',
        operationId: 'refreshToken',
        tags: ['Auth'],
        security: [],
        description:
          'Exchanges a valid refresh token for a new access + refresh token pair. ' +
          'The consumed refresh token is immediately revoked (rotation). ' +
          'Accepts the token in `Authorization: Bearer <token>` header or `refreshToken` body field. ' +
          'Rate-limited to 10 requests per 15 min per IP.',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refreshToken: { type: 'string', description: 'Refresh token (alternative to Bearer header)', example: 'a3f8b1c2d4e5...' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'New token pair issued',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/Tokens' } } },
              },
            },
          },
          401: { description: 'Invalid, expired, or already-revoked refresh token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } } },
          429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },

    '/auth/logout': {
      post: {
        summary: 'Log out (revoke current refresh token)',
        operationId: 'logout',
        tags: ['Auth'],
        description:
          'Revokes the refresh token supplied in the request body. ' +
          'The access token remains valid until its 15-min TTL expires; ' +
          'use `POST /auth/logout-all` to invalidate all outstanding access tokens immediately.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string', example: 'a3f8b1c2d4e5...' },
                },
              },
            },
          },
        },
        responses: {
          204: { description: 'Logged out — no body' },
          400: { description: 'Missing refreshToken', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Invalid or expired access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } } },
        },
      },
    },

    '/auth/logout-all': {
      post: {
        summary: 'Log out everywhere (invalidate all tokens)',
        operationId: 'logoutAll',
        tags: ['Auth'],
        description:
          'Increments the user\'s `token_version`. All outstanding access tokens issued before ' +
          'this call are immediately rejected by `authMiddleware`. All refresh tokens are also revoked.',
        responses: {
          204: { description: 'All sessions terminated — no body' },
          401: { description: 'Invalid or expired access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } } },
        },
      },
    },

    '/auth/register': {
      post: {
        summary: 'Register a new user (admin only)',
        operationId: 'register',
        tags: ['Auth'],
        description:
          'Creates a new user account. Requires an admin access token. ' +
          'Passwords are hashed with bcrypt (cost 12). ' +
          'Roles: `admin` > `operator` > `user`.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string', minLength: 3, maxLength: 32, example: 'alice' },
                  password: { type: 'string', format: 'password', minLength: 8, example: 'hunter2!' },
                  role: {
                    type: 'string',
                    enum: ['admin', 'operator', 'user'],
                    default: 'user',
                    example: 'operator',
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'User created',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { data: { $ref: '#/components/schemas/UserPublic' } } },
              },
            },
          },
          400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Invalid or expired access token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } } },
          403: { description: 'Insufficient role (admin required)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorWithCode' } } } },
          409: { description: 'Username already taken', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
};

module.exports = swaggerSpec;
