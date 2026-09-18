import type { CSVTransactionRow } from './ImportCSVUseCase';

export interface ParseCSVOptions {
  /**
   * Column mapping configuration.
   * Keys are CSV column names (case-insensitive), values are the field names.
   */
  columnMapping?: {
    date?: string;
    description?: string;
    amount?: string;
    payee?: string;
  };
  /**
   * Date format: 'YYYY-MM-DD', 'DD/MM/YYYY', etc.
   * Default: auto-detect common formats
   */
  dateFormat?: 'auto' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
  /**
   * Decimal separator: '.' or ','
   * Default: auto-detect
   */
  decimalSeparator?: 'auto' | '.' | ',';
  /**
   * Thousands separator: ',' or ' ' or '.' or ''
   * Default: auto-detect
   */
  thousandsSeparator?: 'auto' | ',' | ' ' | '.' | '';
}

export interface ParseCSVResult {
  success: boolean;
  rows?: CSVTransactionRow[];
  errors?: string[];
}

/**
 * Parses CSV bank statement data into transaction rows.
 *
 * Supports:
 * - Auto-detection of date formats (YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY)
 * - Auto-detection of decimal/thousands separators (1,234.56 vs 1 234,56)
 * - Flexible column mapping
 * - Validation and error reporting
 */
export function parseCSV(csvContent: string, options: ParseCSVOptions = {}): ParseCSVResult {
  const lines = csvContent
    .trim()
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) {
    return { success: false, errors: ['CSV must have at least a header row and one data row'] };
  }

  const headerLine = lines[0];
  const headers = parseCSVLine(headerLine);

  // Determine column indices
  const columnMapping = options.columnMapping || {};
  const dateCol = findColumn(headers, columnMapping.date || 'date');
  const descCol = findColumn(headers, columnMapping.description || 'description');
  const amountCol = findColumn(headers, columnMapping.amount || 'amount');
  const payeeCol = findColumn(headers, columnMapping.payee || 'payee');

  if (dateCol === -1) {
    return { success: false, errors: ['Could not find date column in CSV header'] };
  }
  if (descCol === -1) {
    return { success: false, errors: ['Could not find description column in CSV header'] };
  }
  if (amountCol === -1) {
    return { success: false, errors: ['Could not find amount column in CSV header'] };
  }

  const rows: CSVTransactionRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const lineNum = i + 1;
    const fields = parseCSVLine(lines[i]);

    if (fields.length < Math.max(dateCol, descCol, amountCol) + 1) {
      errors.push(`Line ${lineNum}: Not enough columns`);
      continue;
    }

    const dateStr = fields[dateCol].trim();
    const descStr = fields[descCol].trim();
    const amountStr = fields[amountCol].trim();
    const payeeStr = payeeCol !== -1 ? fields[payeeCol]?.trim() : undefined;

    // Parse date
    const date = parseDate(dateStr, options.dateFormat);
    if (!date) {
      errors.push(`Line ${lineNum}: Invalid date format: ${dateStr}`);
      continue;
    }

    // Parse amount
    const amountCents = parseAmount(
      amountStr,
      options.decimalSeparator,
      options.thousandsSeparator,
    );
    if (amountCents === null) {
      errors.push(`Line ${lineNum}: Invalid amount: ${amountStr}`);
      continue;
    }

    rows.push({
      date,
      description: descStr,
      amount: Math.abs(amountCents), // Always positive for spending
      payee: payeeStr,
    });
  }

  if (rows.length === 0 && errors.length > 0) {
    return { success: false, errors };
  }

  return { success: true, rows, errors: errors.length > 0 ? errors : undefined };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function findColumn(headers: string[], target: string): number {
  const targetLower = target.toLowerCase();
  return headers.findIndex((h) => h.toLowerCase().trim() === targetLower);
}

function parseDate(dateStr: string, format: ParseCSVOptions['dateFormat'] = 'auto'): string | null {
  if (!dateStr) return null;

  // Try YYYY-MM-DD first (ISO format)
  if (format === 'auto' || format === 'YYYY-MM-DD') {
    const isoMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const [, year, month, day] = isoMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // Try DD/MM/YYYY
  if (format === 'auto' || format === 'DD/MM/YYYY') {
    const ddmmMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (ddmmMatch) {
      const [, day, month, year] = ddmmMatch;
      const d = parseInt(day, 10);
      // If day > 12, it must be DD/MM/YYYY format (can't be MM/DD)
      if (d > 12) {
        return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      }
    }
  }

  // Try MM/DD/YYYY
  if (format === 'auto' || format === 'MM/DD/YYYY') {
    const mmddMatch = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mmddMatch) {
      const [, month, day, year] = mmddMatch;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  return null;
}

function parseAmount(
  amountStr: string,
  decimalSep: ParseCSVOptions['decimalSeparator'] = 'auto',
  thousandsSep: ParseCSVOptions['thousandsSeparator'] = 'auto',
): number | null {
  if (!amountStr) return null;

  let cleaned = amountStr.trim();

  // Remove currency symbols and leading/trailing whitespace
  cleaned = cleaned.replace(/^[R$£€¥₹\s]+/, '').replace(/[R$£€¥₹\s]+$/, '');

  // Handle negative amounts (parentheses or minus)
  const isNegative = cleaned.startsWith('-') || (cleaned.startsWith('(') && cleaned.endsWith(')'));
  cleaned = cleaned.replace(/[()-]/g, '').trim();

  // Auto-detect format if needed
  if (decimalSep === 'auto' || thousandsSep === 'auto') {
    // Look for patterns to determine the format
    const hasComma = cleaned.includes(',');
    const hasPeriod = cleaned.includes('.');
    const hasSpace = /\s/.test(cleaned);

    if (hasComma && hasPeriod) {
      // Both comma and period present
      // Check which comes last - that's the decimal separator
      const lastCommaIdx = cleaned.lastIndexOf(',');
      const lastPeriodIdx = cleaned.lastIndexOf('.');

      if (lastCommaIdx > lastPeriodIdx) {
        // European: 1.234,56
        decimalSep = ',';
        thousandsSep = '.';
      } else {
        // US: 1,234.56
        decimalSep = '.';
        thousandsSep = ',';
      }
    } else if (hasComma && !hasPeriod) {
      // Only comma - could be decimal or thousands
      // If comma has exactly 2 digits after it, it's likely decimal
      if (/,\d{2}$/.test(cleaned)) {
        decimalSep = ',';
        thousandsSep = hasSpace ? ' ' : '';
      } else {
        // Likely thousands separator
        decimalSep = '.';
        thousandsSep = ',';
      }
    } else if (hasPeriod && !hasComma) {
      // Only period - could be decimal or thousands
      // If period has 1-3 digits after it, it's likely decimal (handles .5, .50, .999)
      // If it has exactly 3 digits and no more periods, likely decimal
      if (/\.\d{1,3}$/.test(cleaned) && (cleaned.match(/\./g) || []).length === 1) {
        decimalSep = '.';
        thousandsSep = hasSpace ? ' ' : ',';
      } else {
        // Multiple periods or other pattern - likely thousands separator (European)
        decimalSep = ',';
        thousandsSep = '.';
      }
    } else if (hasSpace) {
      // Only spaces (South African format: 1 234,56)
      // Look for comma - if present, it's the decimal
      if (cleaned.includes(',')) {
        decimalSep = ',';
        thousandsSep = ' ';
      } else {
        // Spaces only, assume period decimal
        decimalSep = '.';
        thousandsSep = ' ';
      }
    } else {
      // No separators - default to US format
      decimalSep = '.';
      thousandsSep = ',';
    }
  }

  // Now clean up: remove thousands separator, keep decimal
  if (thousandsSep === ',') {
    cleaned = cleaned.replace(/,/g, '');
  } else if (thousandsSep === ' ') {
    cleaned = cleaned.replace(/\s+/g, '');
  } else if (thousandsSep === '.') {
    cleaned = cleaned.replace(/\./g, '');
  }

  // Convert decimal separator to period if needed
  if (decimalSep === ',') {
    cleaned = cleaned.replace(',', '.');
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return null;

  const cents = Math.round(Math.abs(parsed) * 100);
  return isNegative ? -cents : cents;
}
