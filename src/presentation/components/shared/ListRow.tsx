import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, TouchableRipple } from 'react-native-paper';
import { useAppTheme } from '../../theme/useAppTheme';
import { spacing } from '../../theme/tokens';

interface ListRowProps {
  title: string;
  subtitle?: string;
  trailing?: React.ReactNode;
  onPress?: () => void;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  trailing,
  onPress,
  testID,
}: ListRowProps): React.JSX.Element {
  const { colors } = useAppTheme();

  const content = (
    <View style={styles.row}>
      <View style={styles.left}>
        <Text
          variant="bodyLarge"
          style={[styles.title, { color: colors.onSurface }]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle !== undefined && (
          <Text
            variant="bodySmall"
            style={[styles.subtitle, { color: colors.onSurfaceVariant }]}
            testID={testID ? `${testID}-subtitle` : undefined}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </View>
  );

  if (onPress !== undefined) {
    return (
      <TouchableRipple onPress={onPress} testID={testID}>
        {content}
      </TouchableRipple>
    );
  }

  return <View testID={testID}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  left: { flex: 1, marginRight: spacing.base },
  title: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  subtitle: { marginTop: 2 },
});
