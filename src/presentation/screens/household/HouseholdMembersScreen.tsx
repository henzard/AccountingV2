/**
 * HouseholdMembersScreen — who is in this household, who can leave, and who
 * an owner can remove.
 *
 * The roster is read from the server (`ListHouseholdMembersUseCase`), because
 * the synced `household_members` table carries only `user_id` — no email, no
 * name — and a list of raw UUIDs is not a roster. Removal and leaving are two
 * genuinely different server paths (an owner RPC vs. the ordinary synced
 * delete op), so they are two different use cases here, not one with a flag.
 */
import React, { useCallback, useRef, useState } from 'react';
import { format } from 'date-fns';
import { View, FlatList, StyleSheet, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Text, Surface, Button, ActivityIndicator, IconButton } from 'react-native-paper';
import { supabase } from '../../../data/remote/supabaseClient';
import { db } from '../../../data/local/db';
import {
  ListHouseholdMembersUseCase,
  type HouseholdMember,
} from '../../../domain/households/ListHouseholdMembersUseCase';
import { RemoveHouseholdMemberUseCase } from '../../../domain/households/RemoveHouseholdMemberUseCase';
import {
  LeaveHouseholdUseCase,
  inspectLeaveHouseholdPreflight,
  type LeaveHouseholdPreflight,
} from '../../../domain/households/LeaveHouseholdUseCase';
import { SlipImageLocalStore } from '../../../infrastructure/slipScanning/SlipImageLocalStore';
import { confirm } from '../../components/shared/ConfirmDialogHost';
import { useAppStore } from '../../stores/appStore';
import { useToastStore } from '../../stores/toastStore';
import { useCelebrationStore } from '../../stores/celebrationStore';
import { useSyncStore } from '../../stores/syncStore';
import { useSlipScannerStore } from '../../stores/slipScannerStore';
import { spacing, radius } from '../../theme/tokens';
import { useAppTheme } from '../../theme/useAppTheme';

/**
 * Structural navigation props. The route is registered by the navigator owner
 * (see this screen's hand-off notes) as
 * `HouseholdMembers: { householdId: string; householdName: string }` on
 * RootStackParamList; typing against the shape used here keeps the screen
 * compiling independently of that registration.
 */
export interface HouseholdMembersScreenProps {
  route: { params: { householdId: string; householdName: string } };
  navigation: { reset: (state: { index: number; routes: { name: string }[] }) => void };
}

/** Members are ordered owners-first, then by join date (the server already
 * orders by join date, so this only lifts the owners). */
function sortMembers(members: HouseholdMember[]): HouseholdMember[] {
  return [...members].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
    return a.joinedAt.localeCompare(b.joinedAt);
  });
}

/**
 * The leave confirmation's body text.
 *
 * The product instruction was "make sure to let the user know and make sure
 * it's synced", so all three facts are stated plainly BEFORE the user agrees:
 * the data leaves THIS phone, the remaining members keep it, and — when there
 * is anything outstanding — what happens to it. Unsynced work is SYNCED
 * first (and the leave is refused outright if it cannot be); dead-lettered
 * work was permanently rejected by the server and is DISCARDED, which is why
 * it is spelled out here with a count instead of silently dropped.
 */
export function buildLeaveConfirmationMessage(
  householdName: string,
  preflight: LeaveHouseholdPreflight,
): string {
  const parts = [
    `You will lose access to ${householdName} on this device and every other one.`,
    `Everything from ${householdName} — transactions, envelopes, debts, meter readings and slips — will be removed from this phone. The remaining members keep it all.`,
  ];
  if (preflight.unsyncedCount > 0) {
    parts.push(
      preflight.unsyncedCount === 1
        ? 'Your 1 unsynced change will be synced first.'
        : `Your ${preflight.unsyncedCount} unsynced changes will be synced first.`,
    );
  }
  if (preflight.deadLetteredCount > 0) {
    parts.push(
      preflight.deadLetteredCount === 1
        ? '1 change the server rejected can never be sent and will be discarded.'
        : `${preflight.deadLetteredCount} changes the server rejected can never be sent and will be discarded.`,
    );
  }
  parts.push('You can rejoin later with a new invite code.');
  return parts.join(' ');
}

function formatJoined(joinedAt: string): string {
  const parsed = new Date(joinedAt);
  if (Number.isNaN(parsed.getTime())) return '—';
  return format(parsed, 'd MMM yyyy');
}

/** What to call a member in the UI: their email, or a short form of their
 * user id when the auth record carries no email. */
function displayName(member: HouseholdMember): string {
  return member.email ?? `User ${member.userId.slice(0, 8)}`;
}

export const HouseholdMembersScreen: React.FC<HouseholdMembersScreenProps> = ({
  route,
  navigation,
}) => {
  const { colors } = useAppTheme();
  const { householdId, householdName } = route.params;

  const session = useAppStore((s) => s.session);
  const availableHouseholds = useAppStore((s) => s.availableHouseholds);
  const setAvailableHouseholds = useAppStore((s) => s.setAvailableHouseholds);
  const setHouseholdId = useAppStore((s) => s.setHouseholdId);
  const setPaydayDay = useAppStore((s) => s.setPaydayDay);
  const clearHousehold = useAppStore((s) => s.clearHousehold);
  const enqueueToast = useToastStore((s) => s.enqueue);

  const userId = session?.user.id ?? null;

  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // HH-2: another owner can add/remove members or change roles while this
  // screen is mounted, and a slower in-flight load can resolve AFTER a
  // newer one (e.g. focus refetch racing a pull-to-refresh). This counter
  // guards state writes so only the most recently started load ever wins —
  // the same pattern MeterDashboardScreen's `loadSeq` uses.
  const loadSeq = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const seq = ++loadSeq.current;
    setError(null);
    const result = await new ListHouseholdMembersUseCase(supabase, { householdId }).execute();
    if (seq !== loadSeq.current) return;
    if (result.success) {
      setMembers(sortMembers(result.data));
    } else {
      setMembers(null);
      setError(result.error.message);
    }
  }, [householdId]);

  // HH-2: refetch every time this screen gains focus (not just on mount) so
  // a roster change made elsewhere — another owner removing someone, a
  // member leaving — is never left stale, including the "sole owner"
  // computation below that gates the Leave button.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const activeOwners = (members ?? []).filter((m) => m.role === 'owner');
  const viewerIsOwner = activeOwners.some((m) => m.userId === userId);
  // Mirrors apply_one_op's `last_owner` rule (and LeaveHouseholdUseCase's
  // pre-check): the only active owner cannot leave. Split out here because a
  // sole owner who is ALSO the only member needs a different explanation from
  // one who still has members to hand over to.
  const soleOwner = viewerIsOwner && activeOwners.length === 1;
  const othersRemain = (members ?? []).some((m) => m.userId !== userId);
  const leaveBlockedReason = !soleOwner
    ? null
    : othersRemain
      ? "You're the only owner. To leave, remove the other members first, or delete your account — ownership then passes to the longest-standing member."
      : 'You are the only person in this household, so there is nobody to hand it over to.';

  const handleRemove = useCallback(
    async (member: HouseholdMember): Promise<void> => {
      const name = displayName(member);
      const confirmed = await confirm({
        title: 'Remove member?',
        message: `${name} will lose access to ${householdName} on every device. They can be invited back later.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (!confirmed) return;

      setBusy(true);
      try {
        const result = await new RemoveHouseholdMemberUseCase(supabase, {
          householdId,
          memberUserId: member.userId,
        }).execute();

        if (!result.success) {
          enqueueToast(result.error.message, 'error');
          return;
        }
        enqueueToast(`${name} was removed from ${householdName}.`, 'success');
        await load();
      } finally {
        setBusy(false);
      }
    },
    [enqueueToast, householdId, householdName, load],
  );

  const handleLeave = useCallback(async (): Promise<void> => {
    if (!userId) return;

    // Counting the outstanding local ops is a read of the phone's own
    // database, but it happens before the user has agreed to anything — a
    // failure here must not block leaving, so it degrades to "nothing
    // outstanding" and the sequence's own oplog checks remain the guarantee.
    let preflight: LeaveHouseholdPreflight = { unsyncedCount: 0, deadLetteredCount: 0 };
    try {
      preflight = inspectLeaveHouseholdPreflight(db, householdId);
    } catch {
      // keep the zeroed default
    }

    const confirmed = await confirm({
      title: 'Leave household?',
      message: buildLeaveConfirmationMessage(householdName, preflight),
      confirmLabel: 'Leave',
      destructive: true,
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await new LeaveHouseholdUseCase(
        db,
        { householdId, userId },
        { slipImages: new SlipImageLocalStore() },
      ).execute();
      if (!result.success) {
        // Every failure shape here is NON-destructive: nothing was purged,
        // and UNSYNCED_CHANGES / LEAVE_NOT_SYNCED are both retryable by
        // pressing Leave again once there is a connection.
        enqueueToast(result.error.message, 'error');
        return;
      }

      const remaining = availableHouseholds.filter((h) => h.id !== householdId);
      setAvailableHouseholds(remaining);

      // Household-scoped store state must not bleed into whatever comes next
      // — same reset HouseholdPickerScreen performs when switching.
      useToastStore.getState().clear();
      useCelebrationStore.getState().clear();
      useSyncStore.getState().reset();
      useSlipScannerStore.getState().setInFlight(null);

      // Scheduled local notifications are NOT household-scoped (the evening
      // log prompt, meter reminder, month-start preflight and budget nudges
      // all use fixed identifiers). RootNavigator's notification effect is
      // keyed on `householdId`, so the store writes below are what cancels
      // and re-arms them: against the next household if there is one, and
      // `cancelAll()` when `hasHousehold` goes false. Cancelling them here
      // too would only race that effect.
      enqueueToast(`You left ${householdName}. Its data is off this phone.`, 'success');

      const next = remaining[0];
      if (next) {
        setHouseholdId(next.id);
        setPaydayDay(next.paydayDay);
        navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
      } else {
        // No household left: clearing it drops RootNavigator to the
        // create/join gate, which owns the navigation from here.
        clearHousehold();
      }
    } finally {
      setBusy(false);
    }
  }, [
    availableHouseholds,
    clearHousehold,
    enqueueToast,
    householdId,
    householdName,
    navigation,
    setAvailableHouseholds,
    setHouseholdId,
    setPaydayDay,
    userId,
  ]);

  if (!members && !error) {
    return (
      <View
        style={[styles.center, { backgroundColor: colors.background }]}
        accessibilityLabel="Loading household members"
        testID="members-loading"
      >
        <ActivityIndicator animating color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <Text
          variant="bodyMedium"
          style={[styles.centerText, { color: colors.error }]}
          testID="members-error"
        >
          {error}
        </Text>
        <Button mode="outlined" onPress={() => void load()} style={styles.retryBtn}>
          Try again
        </Button>
      </View>
    );
  }

  const renderItem = ({ item }: { item: HouseholdMember }): React.JSX.Element => {
    const isYou = item.userId === userId;
    const name = displayName(item);
    const roleLabel = item.role === 'owner' ? 'Owner' : 'Member';
    const canRemove = viewerIsOwner && !isYou && item.role !== 'owner';

    return (
      <Surface
        style={[styles.row, { backgroundColor: colors.surface }]}
        elevation={1}
        testID={`member-row-${item.userId}`}
      >
        <View style={styles.rowLeft}>
          <Text variant="titleSmall" style={[styles.name, { color: colors.onSurface }]}>
            {name}
            {isYou ? ' (You)' : ''}
          </Text>
          <Text variant="bodySmall" style={{ color: colors.onSurfaceVariant }}>
            {roleLabel} · Joined {formatJoined(item.joinedAt)}
          </Text>
        </View>
        {canRemove ? (
          <IconButton
            icon="account-remove-outline"
            iconColor={colors.error}
            disabled={busy}
            onPress={() => void handleRemove(item)}
            accessibilityLabel={`Remove ${name} from ${householdName}`}
            testID={`remove-member-${item.userId}`}
          />
        ) : null}
      </Surface>
    );
  };

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <FlatList
        data={members ?? []}
        keyExtractor={(item) => item.userId}
        renderItem={renderItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            testID="members-refresh-control"
            refreshing={refreshing}
            onRefresh={() => void handleRefresh()}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <Text
            variant="bodyMedium"
            style={[styles.centerText, { color: colors.onSurfaceVariant }]}
            testID="members-empty"
          >
            Nobody is in this household yet.
          </Text>
        }
        ListFooterComponent={
          <View style={styles.footer}>
            {leaveBlockedReason ? (
              <Text
                variant="bodySmall"
                style={[styles.blockedReason, { color: colors.onSurfaceVariant }]}
                testID="leave-blocked-reason"
              >
                {leaveBlockedReason}
              </Text>
            ) : null}
            <Button
              mode="outlined"
              icon="exit-to-app"
              textColor={colors.error}
              disabled={busy || leaveBlockedReason !== null}
              onPress={() => void handleLeave()}
              accessibilityLabel={`Leave ${householdName}`}
              testID="leave-household-btn"
            >
              Leave household
            </Button>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.base },
  centerText: { textAlign: 'center' },
  retryBtn: { marginTop: spacing.base },
  list: { paddingVertical: spacing.base },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.base,
    marginVertical: spacing.xs / 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  rowLeft: { flex: 1 },
  name: { fontFamily: 'PlusJakartaSans_600SemiBold' },
  footer: { padding: spacing.base, gap: spacing.sm },
  blockedReason: { textAlign: 'center' },
});
