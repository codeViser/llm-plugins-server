import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';

// Remove individual registry imports as they will be passed in
// import { excelGeneratorRegistry } from '@/routes/excelGenerator/excelGeneratorRouter';
// import { healthCheckRegistry } from '@/routes/healthCheck/healthCheckRouter';
// ... and so on for all other imported registries

export function generateOpenAPIDocument(registries: OpenAPIRegistry[]) {
  // Accept registries as a parameter
  const combinedRegistry = new OpenAPIRegistry(registries); // Use the passed-in registries
  const generator = new OpenApiGeneratorV3(combinedRegistry.definitions);

  return generator.generateDocument({
    openapi: '3.0.0',
    info: {
      version: '1.0.0',
      title: 'Swagger API',
    },
    externalDocs: {
      description: 'View the raw OpenAPI Specification in JSON format',
      url: '/swagger.json',
    },
  });
}
