import type { Config } from 'drizzle-kit';

export default {
  schema: './src/data/local/schema/index.ts',
  out: './src/data/local/migrations',
  driver: 'expo',
  dialect: 'sqlite',
} satisfies Config;
