# CSV Bank Statement Import

AccountingV2 supports importing transactions from bank statement CSV files. This allows batch-loading historical transactions for Finance assistants.

## Features

- **Idempotent imports** — Transactions are deduplicated via hash (date + amount + payee), so re-importing the same file won't create duplicates
- **Automatic envelope mapping** — Use keyword rules to route transactions to different envelopes
- **Format flexibility** — Supports multiple date formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY) and amount formats (1,234.56 vs 1 234,56)
- **Error handling** — Invalid rows are reported but don't block the import

## Quick Start

### 1. Prepare Your CSV

CSV file must have headers. Required columns:

- **Date** — Transaction date
- **Description** — Transaction description or merchant
- **Amount** — Transaction amount

Optional columns:

- **Payee** — Merchant or payee name (falls back to description if missing)

Example CSV:

```csv
Date,Description,Amount
2026-09-15,Pick n Pay Groceries,125.50
2026-09-16,Shell Fuel Station,85.00
2026-09-17,Woolworths,234.75
```

### 2. Find Your Household and Envelope IDs

You'll need:

- **Household ID** — The UUID of the household to import into
- **Default Envelope ID** — The UUID of the envelope for uncategorized transactions

You can find these in the app database or via the Settings screen.

### 3. Run the Import

```bash
npx tsx scripts/import-csv.ts <csv-file> <household-id> <envelope-id>
```

Example:

```bash
npx tsx scripts/import-csv.ts statements/sept-2026.csv abc123-... def456-...
```

## Supported Formats

### Date Formats

The parser auto-detects these formats:

- `YYYY-MM-DD` (ISO 8601, e.g., `2026-09-15`)
- `DD/MM/YYYY` (e.g., `15/09/2026`)
- `MM/DD/YYYY` (e.g., `09/15/2026`)

You can force a specific format with the `dateFormat` option in code.

### Amount Formats

The parser auto-detects these formats:

- **US/UK**: `1,234.56` (comma thousands, period decimal)
- **South African**: `1 234,56` (space thousands, comma decimal)
- **European**: `1.234,56` (period thousands, comma decimal)

Currency symbols (`R`, `$`, `£`, `€`, etc.) are automatically stripped.

Negative amounts (shown as `(50.00)` or `-50.00`) are converted to positive spending amounts.

## Keyword Mapping

Route transactions to specific envelopes based on keywords in the description:

### 1. Create a mapping file

`mapping.json`:

```json
{
  "groceries": "env-groceries-uuid",
  "fuel": "env-fuel-uuid",
  "restaurant": "env-dining-uuid",
  "pharmacy": "env-health-uuid"
}
```

### 2. Use it in the import

```bash
npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default --mapping mapping.json
```

The importer will:

1. Check if the transaction description contains any keyword (case-insensitive)
2. Route to the mapped envelope if a match is found
3. Fall back to the default envelope otherwise

## Advanced Usage

### Dry Run

Validate your CSV without importing:

```bash
npx tsx scripts/import-csv.ts statements/sept-2026.csv hh-123 env-default --dry-run
```

### Custom Column Names

If your bank uses different column names, create a custom parser in code:

```typescript
import { parseCSV } from '../src/domain/transactions/parseCSV';

const result = parseCSV(csvContent, {
  columnMapping: {
    date: 'Transaction Date',
    description: 'Merchant',
    amount: 'Debit',
    payee: 'Payee Name',
  },
});
```

## Deduplication

Transactions are deduplicated using a SHA-256 hash of:

```
date|amountCents|identifier
```

Where:

- `date` is the ISO date (YYYY-MM-DD)
- `amountCents` is the amount in cents
- `identifier` is the payee or description (lowercase, trimmed)

Example:

```
2026-09-15|12550|pick n pay
```

If you import the same CSV twice, or a CSV with overlapping transactions, duplicates are automatically skipped.

## Error Handling

The importer continues processing even if some rows fail. After completion, you'll see:

```
✓ Import complete:
  - Imported: 45
  - Skipped (duplicates): 3
  - Errors: 2

⚠️  Row errors:
  - Row 12: Invalid date format: 2026/13/45
  - Row 25: Amount must be greater than zero
```

## Limitations

- **No bank login or scraping** — This is a manual CSV import tool. You must download the CSV from your bank.
- **No category auto-detection** — Use keyword mapping for routing, or manually categorize after import.
- **No OFX support** — CSV only for now.
- **No balance reconciliation** — The importer doesn't validate running balances.

## Schema Changes

The CSV import feature adds one optional field to the `transactions` table:

- `transaction_hash` (TEXT) — SHA-256 hash for deduplication

This field is indexed on `(household_id, transaction_hash)` for fast duplicate lookups.

Migration: `0015_transaction_hash.sql`

## Architecture

### Domain Layer

- **ImportCSVUseCase** (`src/domain/transactions/ImportCSVUseCase.ts`)
  - Orchestrates the import: validation, deduplication, batch insert
  - Uses the synced repo pattern to write to oplog for offline-first sync
- **parseCSV** (`src/domain/transactions/parseCSV.ts`)
  - Parses CSV text into structured transaction rows
  - Auto-detects date and amount formats
- **createTransactionHash** (`src/domain/transactions/transactionHash.ts`)
  - Creates deterministic hash for deduplication

### Data Layer

- Migration `0015_transaction_hash.sql` adds the `transaction_hash` column and index

### Infrastructure

- **import-csv.ts** (`scripts/import-csv.ts`)
  - CLI script for running imports from the terminal
  - Connects to local SQLite database
  - Reads CSV files and mapping.json

## Testing

Run the tests:

```bash
npm test parseCSV
npm test ImportCSVUseCase
npm test transactionHash
```

Coverage:

- CSV parser: date formats, amount formats, error handling
- Import use case: deduplication, keyword mapping, validation, envelope checks
- Transaction hash: consistency, normalization

## Examples

### Example 1: Basic Import

CSV (`statements.csv`):

```csv
Date,Description,Amount
2026-09-15,Pick n Pay,125.50
2026-09-16,Shell Fuel,85.00
```

Command:

```bash
npx tsx scripts/import-csv.ts statements.csv hh-123 env-default
```

Result: 2 transactions imported to `env-default`

### Example 2: Import with Keyword Mapping

CSV (`statements.csv`):

```csv
Date,Description,Amount
2026-09-15,Pick n Pay Groceries,125.50
2026-09-16,Shell Fuel Station,85.00
2026-09-17,Clicks Pharmacy,45.00
2026-09-18,Random Store,30.00
```

Mapping (`mapping.json`):

```json
{
  "groceries": "env-groceries",
  "fuel": "env-fuel",
  "pharmacy": "env-health"
}
```

Command:

```bash
npx tsx scripts/import-csv.ts statements.csv hh-123 env-default --mapping mapping.json
```

Result:

- Row 1 → `env-groceries` (matches "groceries")
- Row 2 → `env-fuel` (matches "fuel")
- Row 3 → `env-health` (matches "pharmacy")
- Row 4 → `env-default` (no match)

### Example 3: South African Bank Format

CSV (`fnb-statement.csv`):

```csv
Date,Description,Amount
2026-09-15,Pick n Pay,1 234,56
2026-09-16,Shell,R 850,00
```

The parser auto-detects the format and converts correctly:

- `1 234,56` → 123456 cents
- `R 850,00` → 85000 cents

### Example 4: Handle Duplicates

First import:

```bash
npx tsx scripts/import-csv.ts sept.csv hh-123 env-default
# Output: Imported: 50
```

Second import (same file):

```bash
npx tsx scripts/import-csv.ts sept.csv hh-123 env-default
# Output: Imported: 0, Skipped: 50
```

## Troubleshooting

### "Could not find date column in CSV header"

Your CSV headers don't match the expected names. Options:

1. Rename your columns to `Date`, `Description`, `Amount`
2. Use custom column mapping in code (see Advanced Usage)

### "Invalid date format"

The parser couldn't recognize your date format. Check that dates are in:

- `YYYY-MM-DD`
- `DD/MM/YYYY`
- `MM/DD/YYYY`

### "Envelope not found"

The envelope ID doesn't exist in the household. Double-check:

- The envelope ID is correct
- The envelope belongs to the specified household
- The envelope is not an income envelope (income envelopes are rejected)

### "Amount must be greater than zero"

One of your CSV rows has a zero or negative amount. The importer skips these rows.

## Future Enhancements

Potential improvements (not yet implemented):

- **OFX/QFX support** — Import from OFX files
- **Balance reconciliation** — Validate running balance against CSV
- **Category detection** — ML-based category prediction
- **Mobile UI** — Import screen in the app (currently CLI-only)
- **Scheduled imports** — Automatic imports from connected accounts
