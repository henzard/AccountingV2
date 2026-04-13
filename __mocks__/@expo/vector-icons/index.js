/**
 * Minimal stub for @expo/vector-icons (and any sub-path like /MaterialCommunityIcons).
 * react-native-vector-icons is remapped by the jest-expo preset to this path.
 */
const React = require('react');
const { View } = require('react-native');

function IconComponent({ testID, name, ...rest }) {
  return React.createElement(View, { testID: testID || `icon-${name || 'unknown'}`, ...rest });
}

IconComponent.displayName = 'VectorIcon';

module.exports = IconComponent;
module.exports.default = IconComponent;
module.exports.MaterialCommunityIcons = IconComponent;
