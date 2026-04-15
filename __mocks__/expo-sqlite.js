// Minimal stub so unit tests that import db.ts can load without native modules.
module.exports = {
  openDatabaseSync: jest.fn(() => ({
    execAsync: jest.fn(),
    getAllAsync: jest.fn(),
    runAsync: jest.fn(),
  })),
};
