import { defineConfig } from 'drizzle-kit';

// `npm run db:generate` turns changes in src/db/schema.ts into a new SQL file in ./drizzle.
// Migrations run automatically on app start (src/db/index.ts).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
});
