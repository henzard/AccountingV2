// Mock for expo/src/winter/ImportMetaRegistry to prevent jest@30 scope errors
module.exports = {
  ImportMetaRegistry: {
    get url() {
      return null;
    },
  },
};
