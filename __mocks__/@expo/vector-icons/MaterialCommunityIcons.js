const React = require('react');
const { View } = require('react-native');

// Mock for @expo/vector-icons/MaterialCommunityIcons (mapped from react-native-vector-icons/MaterialCommunityIcons by jest-expo preset)
function MaterialCommunityIcons({ testID, name, ...rest }) {
  return React.createElement(View, { testID: testID || `icon-${name}`, ...rest });
}

module.exports = MaterialCommunityIcons;
module.exports.default = MaterialCommunityIcons;
