// Mock for expo/src/winter — prevents jest@30 scope errors
// caused by lazy global getters firing during test teardown.
// This is a no-op mock since domain tests don't need expo's WinterCG polyfills.
