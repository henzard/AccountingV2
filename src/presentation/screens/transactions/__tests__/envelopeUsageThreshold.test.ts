import { detectThresholdCrossing, buildThresholdToastMessage } from '../envelopeUsageThreshold';

describe('detectThresholdCrossing', () => {
  it('returns null when allocatedCents is zero or negative', () => {
    expect(detectThresholdCrossing(0, 100, 0)).toBeNull();
    expect(detectThresholdCrossing(0, 100, -500)).toBeNull();
  });

  it('returns null when usage stays below 80%', () => {
    expect(detectThresholdCrossing(1000, 5000, 10000)).toBeNull();
  });

  it('returns 80 when this save crosses from under 80% to at/over 80%', () => {
    // allocated 10000: 7000 (70%) -> 8000 (80%)
    expect(detectThresholdCrossing(7000, 8000, 10000)).toBe(80);
  });

  it('does not re-fire 80 when usage was already at/over 80% before this save', () => {
    // 85% -> 90%: already over 80% before this save
    expect(detectThresholdCrossing(8500, 9000, 10000)).toBeNull();
  });

  it('returns 100 when this save crosses from under 100% to at/over 100%', () => {
    expect(detectThresholdCrossing(9000, 10000, 10000)).toBe(100);
    expect(detectThresholdCrossing(9000, 12000, 10000)).toBe(100);
  });

  it('does not re-fire 100 when usage was already at/over 100% before this save', () => {
    expect(detectThresholdCrossing(11000, 12000, 10000)).toBeNull();
  });

  it('prioritizes 100 over 80 when a single save jumps past both', () => {
    // 50% -> 120%: crosses both lines in one save, must report 100 not 80
    expect(detectThresholdCrossing(5000, 12000, 10000)).toBe(100);
  });

  it('returns null when usage decreases (e.g. amount edited down)', () => {
    expect(detectThresholdCrossing(9000, 5000, 10000)).toBeNull();
  });

  it('treats exactly-80% and exactly-100% as crossings', () => {
    expect(detectThresholdCrossing(7999, 8000, 10000)).toBe(80);
    expect(detectThresholdCrossing(9999, 10000, 10000)).toBe(100);
  });
});

describe('buildThresholdToastMessage', () => {
  it('builds the 80%-used message', () => {
    expect(buildThresholdToastMessage(80, 'Groceries', 10000, 8000)).toBe(
      "You've used 80% of Groceries",
    );
  });

  it('builds the over-budget message with the overspend amount via formatCurrency', () => {
    // allocated 10000, spent 12000 -> overspend 2000 cents -> formatCurrency(2000)
    const message = buildThresholdToastMessage(100, 'Groceries', 10000, 12000);
    expect(message).toContain('Groceries is over budget by');
    expect(message).toContain('R20');
  });
});
