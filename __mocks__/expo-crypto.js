// Minimal stub so tests that import code using `expo-crypto` can load
// without the real native module (which requires an RN/Expo bridge that
// doesn't exist under the realsql tier's plain "node" test environment).
// Backed by Node's built-in `crypto.randomUUID()` so callers that don't
// override id generation (e.g. via an injected `genId`) still get a real,
// valid v4 UUID rather than a hardcoded fixture.
const nodeCrypto = require('crypto');

module.exports = {
  randomUUID: () => nodeCrypto.randomUUID(),
};
