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

  components: {
    schemas: {
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
  },
};

module.exports = swaggerSpec;
