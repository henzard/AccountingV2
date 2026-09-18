#!/usr/bin/env tsx
/* eslint-disable */
/**
 * CSV Bank Statement Import CLI
 *
 * Imports transactions from a CSV file into a household.
 *
 * Usage:
 *   npx tsx scripts/import-csv.ts <csv-file> <household-id> <envelope-id> [options]
 *
 * Options:
 *   --mapping <json-file>  JSON file with keyword -> envelopeId mapping
 *   --dry-run             Parse and validate only, do not import
 *
 * Example:
 *   npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default
 *   npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default --mapping mapping.json
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../src/data/local/schema';
import { parseCSV } from '../src/domain/transactions/parseCSV';
import { ImportCSVUseCase } from '../src/domain/transactions/ImportCSVUseCase';
import { AuditLogger } from '../src/data/audit/AuditLogger';

function printUsage() {
  console.log(`
CSV Bank Statement Import CLI

Usage:
  npx tsx scripts/import-csv.ts <csv-file> <household-id> <envelope-id> [options]

Options:
  --mapping <json-file>  JSON file with keyword -> envelopeId mapping
  --dry-run              Parse and validate only, do not import

Example:
  npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default
  npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default --mapping mapping.json

Expected CSV format:
  Date,Description,Amount
  2026-09-15,Pick n Pay,125.50
  2026-09-16,Shell Fuel,85.00

Optional columns: Payee

Supported date formats: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
Supported amount formats: 1234.56, 1,234.56, 1 234,56
  `);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(args.includes('--help') || args.includes('-h') ? 0 : 1);
  }

  const [csvFile, householdId, envelopeId] = args;
  const dryRun = args.includes('--dry-run');
  const mappingIdx = args.indexOf('--mapping');
  const mappingFile = mappingIdx !== -1 ? args[mappingIdx + 1] : null;

  // Read and parse CSV
  console.log(`\nReading CSV: ${csvFile}`);
  const csvContent = readFileSync(resolve(csvFile), 'utf-8');
  const parseResult = parseCSV(csvContent);

  if (!parseResult.success) {
    console.error('\n❌ CSV parsing failed:');
    parseResult.errors?.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  console.log(`✓ Parsed ${parseResult.rows!.length} rows`);
  if (parseResult.errors && parseResult.errors.length > 0) {
    console.warn(`\n⚠️  Parse warnings:`);
    parseResult.errors.forEach((err) => console.warn(`  - ${err}`));
  }

  // Load keyword mapping if provided
  let keywordMapping: Record<string, string> | undefined;
  if (mappingFile) {
    console.log(`\nLoading keyword mapping: ${mappingFile}`);
    const mappingContent = readFileSync(resolve(mappingFile), 'utf-8');
    keywordMapping = JSON.parse(mappingContent);
    console.log(`✓ Loaded ${Object.keys(keywordMapping!).length} keyword rules`);
  }

  if (dryRun) {
    console.log('\n✓ Dry run complete. Use without --dry-run to import.');
    return;
  }

  // Connect to database
  const dbPath = process.env.DB_PATH || './accountingv2.db';
  console.log(`\nConnecting to database: ${dbPath}`);

  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite, { schema });

  // Create audit logger
  const audit = new AuditLogger(db as any);

  // Run import
  console.log(`\nImporting to household: ${householdId}, envelope: ${envelopeId}`);
  const importUseCase = new ImportCSVUseCase(db as any, audit, {
    householdId,
    envelopeId,
    rows: parseResult.rows!,
    keywordMapping,
  });

  const result = await importUseCase.execute();

  if (!result.success) {
    console.error(`\n❌ Import failed: ${result.error.message} (${result.error.code})`);
    process.exit(1);
  }

  // Print results
  console.log(`\n✓ Import complete:`);
  console.log(`  - Imported: ${result.data.imported}`);
  console.log(`  - Skipped (duplicates): ${result.data.skipped}`);
  console.log(`  - Errors: ${result.data.errors.length}`);

  if (result.data.errors.length > 0) {
    console.warn(`\n⚠️  Row errors:`);
    result.data.errors.forEach((err) => {
      console.warn(`  - Row ${err.row}: ${err.reason}`);
    });
  }

  sqlite.close();
}

main().catch((err) => {
  console.error('\n❌ Unexpected error:', err);
  process.exit(1);
});
