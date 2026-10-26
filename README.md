# EQUITAS - Minimal Next.js POC

This is an **extension** to your existing `equitas-admin` project. It is not a standalone repository.

## Only 8 files
- `app/page.tsx`: one screen, controls, six entity tables, five cases, logs.
- `app/layout.tsx`, `app/globals.css`: minimal Next.js interface.
- `app/api/poc/route.ts`: a single API for buttons and queries.
- `src/server/poc.ts`: calls existing MikroORM and existing test motor.
- `src/testing/TestDataFactory.ts`, `ExecutionSimulator.ts`, `ConsoleReporter.ts`: the existing tested POC motor.

## Installation
1. Back up your existing project and only then merge this ZIP into its root. **Keep `src/db` and `src/model` unchanged.**
2. Install if missing: `npm install next react react-dom server-only` and `npm install -D @types/react @types/react-dom`.
3. Add these scripts to `package.json`: `"dev": "next dev", "build": "next build", "start": "next start"`.
4. In `.env.local`, preserve existing database settings and add:

```env
POC_ADMIN_TOKEN=replace-with-a-long-private-value
ENABLE_POC_ADMIN=false
HOP_SERVER_URL=http://127.0.0.1:8080
HOP_USERNAME=
HOP_PASSWORD=
```

5. Run `npx tsc --noEmit`, then `npm run dev`; open `http://localhost:3000`.
6. Enter the token in the interface and select **Initialize Database**, then **Run Case 1**.

## Important
- `Initialize Database` creates/updates the schema and seeds the POC without executing cases.
- `Delete Database` drops the configured POC schema and its records; do not run against real data.
- `Clear Execution Logs` deletes logs only.
- Each Run Case adds logs without resetting the database.
- Apache Hop button checks connectivity only; it does not execute a pipeline.
- The system is for **local test environments**; token entry is not a substitute for full production authentication.
- The code has **not been run against your PostgreSQL instance**. Check compatibility with the installed MikroORM version and the six existing entity definitions.
