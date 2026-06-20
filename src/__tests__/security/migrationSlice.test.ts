import { sliceMigrationFrom, sliceMigrationSection } from '../../__test-utils__/migrationSlice';

describe('migrationSlice helpers', () => {
  const sql = `-- header
CREATE OR REPLACE FUNCTION public.merge_envelope() AS $$ BEGIN END; $$;
GRANT EXECUTE ON FUNCTION public.merge_envelope TO authenticated;
-- tail`;

  it('sliceMigrationSection extracts between markers', () => {
    const section = sliceMigrationSection(
      sql,
      'CREATE OR REPLACE FUNCTION public.merge_envelope',
      'GRANT EXECUTE ON FUNCTION public.merge_envelope',
    );
    expect(section).toContain('merge_envelope');
    expect(section).not.toContain('GRANT EXECUTE');
  });

  it('sliceMigrationSection throws when start marker missing', () => {
    expect(() =>
      sliceMigrationSection(
        sql,
        'MISSING START',
        'GRANT EXECUTE ON FUNCTION public.merge_envelope',
      ),
    ).toThrow(/start marker not found/);
  });

  it('sliceMigrationSection throws when end marker missing', () => {
    expect(() =>
      sliceMigrationSection(sql, 'CREATE OR REPLACE FUNCTION public.merge_envelope', 'MISSING END'),
    ).toThrow(/end marker not found/);
  });

  it('sliceMigrationFrom extracts from start marker through EOF', () => {
    const section = sliceMigrationFrom(sql, 'GRANT EXECUTE');
    expect(section).toContain('GRANT EXECUTE');
    expect(section).toContain('-- tail');
  });

  it('sliceMigrationFrom throws when start marker missing', () => {
    expect(() => sliceMigrationFrom(sql, 'MISSING')).toThrow(/start marker not found/);
  });
});
