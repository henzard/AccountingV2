import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';
import * as SQLite from 'expo-sqlite';

// App is loaded via require (not a static top-level import) so that on web we
// can run an async SQLite worker warm-up BEFORE `./App` pulls in the
// synchronous data layer. require() resolves from the same bundle, so this
// does not create an async chunk (which `output: 'single'` cannot load).
function loadApp(): React.ComponentType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./App').default;
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App).
if (Platform.OS === 'web') {
  // On web, expo-sqlite runs SQLite in a shared Web Worker backed by a ~600KB
  // wa-sqlite `.wasm`. Its SYNCHRONOUS API (used throughout the data layer via
  // `openDatabaseSync` + drizzle) busy-waits on a SharedArrayBuffer for the
  // worker to reply, but only for a bounded number of spins. At cold start the
  // first synchronous call — `openDatabaseSync(...)` at `src/data/local/db.ts`
  // import time — races the worker's one-time wasm load and loses, throwing
  // "Sync operation timeout" and leaving the app blank.
  //
  // Warm the shared worker with an ASYNCHRONOUS op against an in-memory db
  // first (no busy-wait, no OPFS-lock contention). Once the wasm is loaded the
  // same worker answers the later synchronous calls within the spin budget.
  void (async (): Promise<void> => {
    try {
      const warm = await SQLite.openDatabaseAsync(':memory:');
      await warm.getFirstAsync('PRAGMA user_version');
      // Intentionally not closed: keep the shared worker alive/warm.
    } catch {
      // Best-effort warm-up; fall through to normal boot regardless.
    }
    registerRootComponent(loadApp());
  })();
} else {
  // Native: register synchronously during initial bundle execution, exactly as
  // before — AppRegistry must have 'main' registered before runApplication.
  registerRootComponent(loadApp());
}
