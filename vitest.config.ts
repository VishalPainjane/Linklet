import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@linklet/shared-types": resolve(__dirname, "packages/shared-types/src/index.ts"),
      "@linklet/code-generator": resolve(__dirname, "packages/code-generator/src/index.ts"),
      "@linklet/validation": resolve(__dirname, "packages/validation/src/index.ts"),
      "@linklet/cache": resolve(__dirname, "packages/cache/src/index.ts"),
      "@linklet/events": resolve(__dirname, "packages/events/src/index.ts"),
      "@linklet/rate-limiter": resolve(__dirname, "packages/rate-limiter/src/index.ts"),
      "@linklet/database": resolve(__dirname, "packages/database/src/index.ts"),
      "@linklet/core": resolve(__dirname, "packages/core/src/index.ts"),
      "@linklet/adapter-postgres-node": resolve(__dirname, "adapters/postgres-node/src/index.ts"),
      "@linklet/adapter-redis-node": resolve(__dirname, "adapters/redis-node/src/index.ts"),
      "@linklet/adapter-rabbitmq": resolve(__dirname, "adapters/rabbitmq/src/index.ts"),
      "@linklet/load-generator": resolve(__dirname, "testing/load-generator/src/engine.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
  },
});

