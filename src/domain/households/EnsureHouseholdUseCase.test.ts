import { EnsureHouseholdUseCase } from './EnsureHouseholdUseCase';

const makeDb = (existing: object | null) => ({
  select: jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(existing ? [existing] : []),
      }),
    }),
  }),
  insert: jest.fn().mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) }),
});

const makeAudit = () => ({ log: jest.fn().mockResolvedValue(undefined) });

describe('EnsureHouseholdUseCase', () => {
  it('returns existing household when found', async () => {
    const db = makeDb({ id: 'user-abc', paydayDay: 1, name: 'Test' });
    const audit = makeAudit();
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-abc');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('user-abc');
      expect(result.data.paydayDay).toBe(1);
    }
    expect(db.insert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('creates household when not found', async () => {
    const db = makeDb(null);
    const audit = makeAudit();
    const uc = new EnsureHouseholdUseCase(db as any, audit as any, 'user-xyz');
    const result = await uc.execute();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('user-xyz');
      expect(result.data.paydayDay).toBe(25);
    }
    expect(db.insert).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });
});
