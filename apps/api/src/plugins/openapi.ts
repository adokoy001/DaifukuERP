// Spec AC-6: OpenAPI 3.1 at /openapi.json (derived from the zod schemas on each route) and Swagger UI at /docs.
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';

export const API_VERSION = '0.0.1';

export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(fastifySwagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Daifuku API',
        version: API_VERSION,
        description:
          'Auto-generated from the kernel registry (ADR-0009). Every business operation is `POST /actions/<name>`; ' +
          '`/api/<entity>` is REST sugar over the generic entity actions. Errors are `{ error: { code, message, hint, details } }`.',
      },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });
  await app.register(fastifySwaggerUi, { routePrefix: '/docs' });
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
}
