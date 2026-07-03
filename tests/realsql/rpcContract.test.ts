// rpcContract.test.ts
//
// Drift gate between Postgres RPC signatures (supabase/migrations/*.sql) and
// client call sites (src/**/*.ts{,x}). Written FIRST (TDD): this fails today
// against AcceptInviteUseCase's `invite_code` vs the SQL function's
// `p_invite_code` parameter, and would fail again if that fix were reverted.
//
// Method: for every `CREATE (OR REPLACE) FUNCTION public.<name>(<args>)`
// signature found in the migrations, find every literal
// `.rpc('<name>', { ... })` call site in src/ and assert that every named key
// in that call site's object literal is one of the SQL function's parameter
// names. Call sites whose name has no matching SQL function are out of scope
// for this assertion (e.g. legacy/dynamic RPC names) — this test only checks
// drift for RPCs it can actually find a signature for.

import * as fs from 'fs';
import * as path from 'path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../supabase/migrations');
const SRC_DIR = path.resolve(__dirname, '../../src');

interface SqlFunctionSignature {
  name: string;
  params: string[];
}

function listSqlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => path.join(dir, f));
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Splits a Postgres function argument list on top-level commas (no nested parens expected here). */
function splitArgs(argList: string): string[] {
  const trimmed = argList.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(',').map((s) => s.trim());
}

function parseSqlFunctions(sql: string): SqlFunctionSignature[] {
  const signatures: SqlFunctionSignature[] = [];
  const fnRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(([^)]*)\)/gis;
  let match: RegExpExecArray | null;
  while ((match = fnRegex.exec(sql)) !== null) {
    const [, name, argList] = match;
    const params = splitArgs(argList)
      .map((arg) => {
        const paramMatch = /^(\w+)/.exec(arg);
        return paramMatch ? paramMatch[1] : null;
      })
      .filter((p): p is string => p !== null);
    signatures.push({ name, params });
  }
  return signatures;
}

interface RpcCallSite {
  functionName: string;
  argKeys: string[];
  file: string;
}

function parseRpcCallSites(source: string, file: string): RpcCallSite[] {
  const sites: RpcCallSite[] = [];
  // Matches `.rpc('name', { ...object literal... })` — object body assumed
  // flat (no nested braces), which holds for every current call site.
  const callRegex = /\.rpc\(\s*['"](\w+)['"]\s*,\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = callRegex.exec(source)) !== null) {
    const [, functionName, body] = match;
    const keyRegex = /(?:^|[{,\s])([A-Za-z_]\w*)\s*:/g;
    const argKeys: string[] = [];
    let keyMatch: RegExpExecArray | null;
    while ((keyMatch = keyRegex.exec(body)) !== null) {
      argKeys.push(keyMatch[1]);
    }
    sites.push({ functionName, argKeys, file });
  }
  return sites;
}

describe('RPC signature contract (SQL <-> client call sites)', () => {
  const sqlFunctions = listSqlFiles(MIGRATIONS_DIR).flatMap((file) =>
    parseSqlFunctions(fs.readFileSync(file, 'utf8')),
  );

  const sourceFiles = listSourceFiles(SRC_DIR);
  const allCallSites = sourceFiles.flatMap((file) =>
    parseRpcCallSites(fs.readFileSync(file, 'utf8'), path.relative(SRC_DIR, file)),
  );

  it('finds at least one public RPC function in the migrations', () => {
    expect(sqlFunctions.length).toBeGreaterThan(0);
  });

  it('finds at least one .rpc() call site in src/', () => {
    expect(allCallSites.length).toBeGreaterThan(0);
  });

  it.each(sqlFunctions.map((fn) => [fn.name, fn] as const))(
    'every call site for public.%s passes only args matching its parameters',
    (_name, fn) => {
      const callSites = allCallSites.filter((site) => site.functionName === fn.name);
      for (const site of callSites) {
        for (const key of site.argKeys) {
          expect({
            function: fn.name,
            file: site.file,
            arg: key,
            validParams: fn.params,
          }).toEqual({
            function: fn.name,
            file: site.file,
            arg: key,
            validParams: expect.arrayContaining([key]),
          });
        }
      }
    },
  );

  it('checked at least one RPC that has both a SQL signature and a client call site', () => {
    const checked = sqlFunctions.filter((fn) =>
      allCallSites.some((site) => site.functionName === fn.name),
    );
    expect(checked.length).toBeGreaterThan(0);
  });
});
