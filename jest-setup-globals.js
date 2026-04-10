// Pre-define __ExpoImportMetaRegistry to prevent jest@30 scope errors
// when expo's lazy global getter fires during test teardown.
// See: https://github.com/expo/expo/issues with jest@30 + expo@55
if (typeof globalThis.__ExpoImportMetaRegistry === 'undefined') {
  Object.defineProperty(globalThis, '__ExpoImportMetaRegistry', {
    value: { url: null },
    configurable: true,
    writable: true,
    enumerable: false,
  });
}
