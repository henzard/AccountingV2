import { parseCSV } from '../parseCSV';

describe('parseCSV', () => {
  it('parses basic CSV with standard format', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,125.50
2026-09-16,Fuel Station,85.00`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows![0]).toEqual({
      date: '2026-09-15',
      description: 'Grocery Store',
      amount: 12550,
      payee: undefined,
    });
    expect(result.rows![1]).toEqual({
      date: '2026-09-16',
      description: 'Fuel Station',
      amount: 8500,
      payee: undefined,
    });
  });

  it('parses CSV with payee column', () => {
    const csv = `Date,Payee,Description,Amount
2026-09-15,Pick n Pay,Groceries,125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0]).toEqual({
      date: '2026-09-15',
      description: 'Groceries',
      amount: 12550,
      payee: 'Pick n Pay',
    });
  });

  it('handles South African format: 1 234,56', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,"1 234,56"`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(123456);
  });

  it('handles US format: 1,234.56', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,"1,234.56"`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(123456);
  });

  it('handles European format: 1.234,56', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,"1.234,56"`;

    const result = parseCSV(csv, { decimalSeparator: ',', thousandsSeparator: '.' });

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(123456);
  });

  it('handles currency symbols', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,R125.50
2026-09-16,Fuel Station,$85.00`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(12550);
    expect(result.rows![1].amount).toBe(8500);
  });

  it('handles negative amounts (parentheses)', () => {
    const csv = `Date,Description,Amount
2026-09-15,Refund,(50.00)`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(5000); // Always positive
  });

  it('handles negative amounts (minus sign)', () => {
    const csv = `Date,Description,Amount
2026-09-15,Refund,-50.00`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(5000); // Always positive
  });

  it('parses DD/MM/YYYY date format', () => {
    const csv = `Date,Description,Amount
15/09/2026,Grocery Store,125.50`;

    const result = parseCSV(csv, { dateFormat: 'DD/MM/YYYY' });

    expect(result.success).toBe(true);
    expect(result.rows![0].date).toBe('2026-09-15');
  });

  it('parses MM/DD/YYYY date format', () => {
    const csv = `Date,Description,Amount
09/15/2026,Grocery Store,125.50`;

    const result = parseCSV(csv, { dateFormat: 'MM/DD/YYYY' });

    expect(result.success).toBe(true);
    expect(result.rows![0].date).toBe('2026-09-15');
  });

  it('auto-detects DD/MM/YYYY when day > 12', () => {
    const csv = `Date,Description,Amount
25/09/2026,Grocery Store,125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].date).toBe('2026-09-25');
  });

  it('handles quoted fields with commas', () => {
    const csv = `Date,Description,Amount
2026-09-15,"Store, Inc.",125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].description).toBe('Store, Inc.');
  });

  it('handles quoted fields with escaped quotes', () => {
    const csv = `Date,Description,Amount
2026-09-15,"Store ""Mega"" Mart",125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].description).toBe('Store "Mega" Mart');
  });

  it('returns error for missing date column', () => {
    const csv = `Description,Amount
Grocery Store,125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Could not find date column in CSV header');
  });

  it('returns error for missing description column', () => {
    const csv = `Date,Amount
2026-09-15,125.50`;

    const result = parseCSV(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Could not find description column in CSV header');
  });

  it('returns error for missing amount column', () => {
    const csv = `Date,Description
2026-09-15,Grocery Store`;

    const result = parseCSV(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Could not find amount column in CSV header');
  });

  it('collects errors for invalid rows but continues parsing', () => {
    const csv = `Date,Description,Amount
2026-09-15,Valid Row,125.50
invalid-date,Invalid Date,50.00
2026-09-17,Invalid Amount,not-a-number
2026-09-18,Another Valid,75.00`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toContain('Line 3: Invalid date format: invalid-date');
    expect(result.errors).toContain('Line 4: Invalid amount: not-a-number');
  });

  it('returns failure when no valid rows parsed', () => {
    const csv = `Date,Description,Amount
invalid-date,Invalid,not-a-number`;

    const result = parseCSV(csv);

    expect(result.success).toBe(false);
    expect(result.errors!.length).toBeGreaterThan(0);
  });

  it('handles empty CSV', () => {
    const result = parseCSV('');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('CSV must have at least a header row and one data row');
  });

  it('handles CSV with only header', () => {
    const csv = `Date,Description,Amount`;

    const result = parseCSV(csv);

    expect(result.success).toBe(false);
    expect(result.errors).toContain('CSV must have at least a header row and one data row');
  });

  it('uses custom column mapping', () => {
    const csv = `Transaction Date,Merchant,Debit
2026-09-15,Pick n Pay,125.50`;

    const result = parseCSV(csv, {
      columnMapping: {
        date: 'Transaction Date',
        description: 'Merchant',
        amount: 'Debit',
      },
    });

    expect(result.success).toBe(true);
    expect(result.rows![0]).toEqual({
      date: '2026-09-15',
      description: 'Pick n Pay',
      amount: 12550,
      payee: undefined,
    });
  });

  it('handles amounts with no decimal part', () => {
    const csv = `Date,Description,Amount
2026-09-15,Grocery Store,125`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(12500);
  });

  it('rounds cents correctly', () => {
    const csv = `Date,Description,Amount
2026-09-15,Test,10.999`;

    const result = parseCSV(csv);

    expect(result.success).toBe(true);
    expect(result.rows![0].amount).toBe(1100);
  });
});
