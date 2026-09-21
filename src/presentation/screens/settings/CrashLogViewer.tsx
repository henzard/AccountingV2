/**
 * CrashLogViewer.tsx
 *
 * Settings sub-screen that reads the early-boot crash record and presents it
 * to the user. Accessible via Settings → "Crash log" row (dev-mode or always,
 * your call — the SettingsScreen patch gates it on __DEV__ by default).
 *
 * Features:
 *  - Displays timestamp, boot step, message, and full stack trace.
 *  - Copy button: copies the full record as plain text to the clipboard.
 *  - Clear button: removes the stored record from AsyncStorage.
 *  - No record → friendly empty state.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Share, StyleSheet, View } from 'react-native';
import { Button, Divider, Surface, Text } from 'react-native-paper';
import {
  clearLastCrash,
  readLastCrash,
  type CrashRecord,
} from '../../../infrastructure/monitoring/earlyCrashLog';
import { useAppTheme } from '../../theme/useAppTheme';
import { radius, spacing } from '../../theme/tokens';

// ─── Component ────────────────────────────────────────────────────────────────

export function CrashLogViewer(): React.JSX.Element {
  const { colors } = useAppTheme();
  const [record, setRecord] = useState<CrashRecord | null | undefined>(undefined); // undefined = loading
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const r = await readLastCrash();
    setRecord(r);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Clear the "Shared!" reset timer on unmount so it never fires setState
  // against an unmounted component.
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (!record) return;
    const text = [
      `Timestamp : ${record.timestamp}`,
      `Boot step : ${record.step}`,
      `Message   : ${record.message}`,
      '',
      record.stack,
    ].join('\n');
    setShareError(false);
    try {
      // Share sheet works without a third-party clipboard package and also
      // lets the user paste into a bug report, email, or Slack directly.
      const result = await Share.share({ message: text, title: 'Crash log' });
      // iOS resolves (doesn't reject) a dismissed share sheet with
      // Share.dismissedAction — only confirm when the user actually shared.
      if (result.action === Share.dismissedAction) return;
      setCopied(true);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareError(true);
    }
  }, [record]);

  const handleClear = useCallback(async () => {
    await clearLastCrash();
    setRecord(null);
  }, []);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (record === undefined) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text variant="bodyMedium" style={{ color: colors.onSurfaceVariant }}>
          Loading…
        </Text>
      </View>
    );
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (record === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text variant="titleMedium" style={{ color: colors.onSurface }}>
          No crash record
        </Text>
        <Text variant="bodySmall" style={[styles.emptyHint, { color: colors.onSurfaceVariant }]}>
          If the app crashed before Crashlytics initialised, the record would appear here.
        </Text>
      </View>
    );
  }

  // ── Record found ──────────────────────────────────────────────────────────
  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.scroll} testID="crash-log-scroll">
        {/* Header metadata */}
        <Surface style={[styles.card, { backgroundColor: colors.surface }]} elevation={0}>
          <Row label="Timestamp" value={record.timestamp} colors={colors} />
          <Divider />
          <Row label="Boot step" value={record.step} colors={colors} />
          <Divider />
          <Row label="Message" value={record.message} colors={colors} />
        </Surface>

        {/* Stack trace */}
        <Text variant="labelSmall" style={[styles.stackLabel, { color: colors.onSurfaceVariant }]}>
          STACK TRACE
        </Text>
        <Surface style={[styles.stackCard, { backgroundColor: colors.surface }]} elevation={0}>
          <Text
            variant="bodySmall"
            style={[styles.stackText, { color: colors.onSurface }]}
            selectable
            testID="crash-stack-text"
          >
            {record.stack}
          </Text>
        </Surface>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            mode="outlined"
            icon={copied ? 'check' : 'share-variant-outline'}
            onPress={handleCopy}
            style={styles.actionButton}
            testID="crash-copy-button"
          >
            {copied ? 'Shared!' : 'Share / copy'}
          </Button>
          <Button
            mode="outlined"
            icon="trash-can-outline"
            onPress={handleClear}
            textColor={colors.error}
            style={[styles.actionButton, { borderColor: colors.error }]}
            testID="crash-clear-button"
          >
            Clear record
          </Button>
        </View>
        {shareError && (
          <Text
            variant="bodySmall"
            style={[styles.shareErrorText, { color: colors.error }]}
            testID="crash-share-error"
          >
            Couldn't share — select and copy the text above instead.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  colors: any;
}

function Row({ label, value, colors }: RowProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      <Text variant="labelSmall" style={[styles.rowLabel, { color: colors.onSurfaceVariant }]}>
        {label.toUpperCase()}
      </Text>
      <Text variant="bodyMedium" style={{ color: colors.onSurface }} selectable>
        {value}
      </Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyHint: {
    marginTop: spacing.base,
    textAlign: 'center',
  },
  scroll: {
    padding: spacing.base,
    paddingBottom: spacing.xl,
  },
  card: {
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  rowLabel: {
    marginBottom: 2,
  },
  stackLabel: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: spacing.xs,
    letterSpacing: 0.8,
  },
  stackCard: {
    borderRadius: radius.md,
    padding: spacing.base,
  },
  stackText: {
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  actions: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  actionButton: {
    borderRadius: radius.md,
  },
  shareErrorText: {
    marginTop: spacing.sm,
  },
});
