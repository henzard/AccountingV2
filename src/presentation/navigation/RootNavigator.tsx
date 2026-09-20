import React, { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { AppStateStatus } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { CreateHouseholdNavigator } from './CreateHouseholdNavigator';
import { OnboardingNavigator } from '../screens/auth/onboarding/OnboardingNavigator';
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { HouseholdMembersScreen } from '../screens/household/HouseholdMembersScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { LoadingSplash } from '../components/shared/LoadingSplash';
import { ConfirmDialogHost } from '../components/shared/ConfirmDialogHost';
import { ToastHost } from '../components/shared/ToastHost';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import { isOnboardingComplete } from '../../infrastructure/storage/onboardingFlag';
import type { RootStackParamList } from './types';
import { SlipScanningScreen } from './SlipScanningScreen';
import { useAppTheme } from '../theme/useAppTheme';
import {
  hasLoggedTransactionToday,
  rearmEveningLogPrompt,
  rearmBudgetNudges,
} from '../boot/eveningLogPrompt';

export { rearmEveningLogPrompt, rearmBudgetNudges };

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefsRepo = new NotificationPreferencesRepository();

/** Navigate-without-a-navigation-prop handle for the notification-tap
 * listener (VAL-12), which fires outside any screen's render tree. */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * VAL-12: maps a scheduled notification's `data.target` (set by
 * `LocalNotificationScheduler`) to where a tap on it should navigate. A pure
 * function so the mapping is testable without rendering/mocking navigation.
 */
export function resolveNotificationTarget(
  target: unknown,
): { screen: 'Main'; params: object } | null {
  switch (target) {
    case 'add_transaction':
      return {
        screen: 'Main',
        // REG-10: without `initial: false`, navigating into the Transactions
        // tab's stack navigator for the FIRST time (it was never visited
        // this session) makes AddTransaction its only route — there is no
        // TransactionList underneath to land on after Save, so the tab is
        // stuck on a blank Add form. `initial: false` tells react-navigation
        // to still mount the stack's normal initial route first and push
        // AddTransaction on top of it.
        params: { screen: 'Transactions', params: { screen: 'AddTransaction' }, initial: false },
      };
    case 'meters':
      return { screen: 'Main', params: { screen: 'Meters' } };
    case 'dashboard':
      return { screen: 'Main', params: { screen: 'DashboardTab' } };
    default:
      return null;
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export function RootNavigator(): React.JSX.Element {
  const { colors } = useAppTheme();
  const session = useAppStore((s) => s.session);
  const householdId = useAppStore((s) => s.householdId);
  const passwordRecoveryPending = useAppStore((s) => s.passwordRecoveryPending);
  const passwordRecoveryError = useAppStore((s) => s.passwordRecoveryError);
  const paydayDay = useAppStore((s) => s.paydayDay);
  const { setPreferences, setPermissionsGranted } = useNotificationStore();

  const onboardingCompleted = useAppStore((s) => s.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((s) => s.setOnboardingCompleted);

  // Resolve onboarding flag whenever session + household are known. Depend on
  // user id (not session object) so Supabase TOKEN_REFRESHED events don't
  // transiently reset the flag to null.
  const userId = session?.user?.id ?? null;
  useEffect(() => {
    if (!userId || !householdId) {
      setOnboardingCompleted(null);
      return;
    }
    let cancelled = false;
    isOnboardingComplete(userId, householdId)
      .then((done) => {
        if (!cancelled) setOnboardingCompleted(done);
      })
      .catch(() => {
        // AsyncStorage failure — default to not complete so the wizard re-runs
        // rather than leaving the user stuck on LoadingSplash.
        if (!cancelled) setOnboardingCompleted(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, householdId, setOnboardingCompleted]);

  const isAuthenticated = Boolean(session);
  const hasHousehold = Boolean(householdId);
  // UX-20: don't prompt for the OS notification permission at the
  // household-creation gate — the household is created before Welcome/
  // onboarding has given the user any context for why the app wants it.
  // Defer the whole init (permission request + reminder scheduling) until
  // onboarding is complete, using the same flag that already decides
  // Onboarding vs. Main below.
  const readyForNotifications = isAuthenticated && hasHousehold && onboardingCompleted === true;

  useEffect(() => {
    if (!isAuthenticated || !hasHousehold) {
      void new LocalNotificationScheduler().cancelAll();
      return;
    }
    if (!readyForNotifications) {
      // Onboarding not finished yet (or its flag hasn't resolved) — do
      // nothing; nothing has been scheduled yet either, so there's nothing
      // to cancel.
      return;
    }
    // householdId is guaranteed non-null here (hasHousehold === true above),
    // but isn't narrowed automatically since it's a separate hook read.
    const currentHouseholdId = householdId;
    if (!currentHouseholdId) return;

    const scheduler = new LocalNotificationScheduler({
      hasLoggedTransactionToday: () => hasLoggedTransactionToday(currentHouseholdId),
    });

    const initNotifications = async (): Promise<void> => {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      setPermissionsGranted(granted);

      const prefs = await prefsRepo.load();
      setPreferences(prefs);

      if (!granted) return;

      if (prefs.eveningLogPromptEnabled) {
        await scheduler.scheduleEveningLogPrompt(
          prefs.eveningLogPromptHour,
          prefs.eveningLogPromptMinute,
        );
      }
      if (prefs.meterReadingReminderEnabled) {
        await scheduler.scheduleMeterReadingReminder(prefs.meterReadingReminderDay);
      }
      if (prefs.monthStartPreflightEnabled) {
        await scheduler.scheduleMonthStartPreflight(paydayDay);
      }
      // VAL2-11: pull-back nudges — reads the preferences/permission just
      // set above straight back out of the stores, so it arms only what
      // this init just enabled.
      await rearmBudgetNudges();
    };

    void initNotifications();
  }, [
    isAuthenticated,
    hasHousehold,
    readyForNotifications,
    householdId,
    paydayDay,
    setPreferences,
    setPermissionsGranted,
  ]);

  // REG-10: a tap that COLD-STARTS the app fires no
  // `addNotificationResponseReceivedListener` event at all — the OS already
  // "delivered" the response to the app before this component (or the
  // listener below) ever existed — and even a warm-start tap can arrive
  // before `NavigationContainer` is ready. Both cases used to just drop the
  // tap silently. A pending target is queued here and flushed either
  // immediately (if the container is already ready) or from
  // `NavigationContainer`'s `onReady` below.
  const pendingNotificationTargetRef = useRef<{ screen: 'Main'; params: object } | null>(null);

  const navigateToTarget = useCallback((route: { screen: 'Main'; params: object }): void => {
    // `RootStackParamList.Main` is declared as `undefined` (types.ts, not
    // owned here) — it doesn't carry the `NavigatorScreenParams<...>` shape
    // react-navigation needs to type-check navigating into a NESTED screen
    // (tab -> stack -> screen), so `.navigate` rejects this call as `never`
    // at the type level even though it's the documented react-navigation
    // pattern for it (the same escape hatch SlipProcessingScreen's
    // `getParent()?.navigate('Main', {...})` already uses). Cast through
    // `unknown`, never `any`.
    const navigate = navigationRef.navigate as unknown as (screen: string, params?: object) => void;
    navigate(route.screen, route.params);
  }, []);

  const handleNotificationTarget = useCallback(
    (target: unknown): void => {
      const route = resolveNotificationTarget(target);
      if (!route) return;
      if (navigationRef.isReady()) {
        navigateToTarget(route);
      } else {
        // Container isn't mounted/ready yet — flushed from `onReady` below.
        pendingNotificationTargetRef.current = route;
      }
    },
    [navigateToTarget],
  );

  // VAL-12/REG-10: route a tap on a delivered notification to the relevant
  // screen, via `navigationRef` since this fires outside any screen's render
  // tree. Covers a WARM-start tap (app already running/backgrounded).
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationTarget(response.notification.request.content.data?.target);
    });
    return () => sub.remove();
  }, [handleNotificationTarget]);

  // REG-10: covers a COLD-start tap — the notification that actually
  // launched the app. `getLastNotificationResponseAsync` is the only way to
  // observe this; the listener above never fires for it because nothing was
  // subscribed yet when the OS delivered the response.
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) handleNotificationTarget(response.notification.request.content.data?.target);
      })
      .catch(() => {});
  }, [handleNotificationTarget]);

  // VAL2-1: re-arm the evening-log rolling window whenever the app comes to
  // the foreground — closes the gap where a transaction logged while
  // backgrounded (or on another device, synced in) would otherwise only be
  // picked up the next time this navigator's own init effect happens to
  // re-run.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void rearmEveningLogPrompt();
        // VAL2-11: pull-back nudges — same "recompute on foreground" reason
        // as the evening-log rearm above (a transaction logged elsewhere
        // while backgrounded should be reflected next time these fire).
        void rearmBudgetNudges();
      }
    });
    return () => sub.remove();
  }, []);

  // Determine which navigator to show
  const renderNavigator = (): React.JSX.Element => {
    // Takes priority over everything else, including a signed-in session —
    // the temporary recovery session App.tsx's deep-link handler establishes
    // via `setSession` DOES make `isAuthenticated` true, but the user must
    // set a new password before landing in the normal app. Also shown when
    // `passwordRecoveryError` is set (the deep link's `setSession` call
    // rejected — bad/expired/reused link): `passwordRecoveryPending` has
    // already been flipped back to false by then (there's no session to
    // reset a password on), but we keep ResetPasswordScreen up so it can
    // surface the error + a "Back to sign in" way out instead of silently
    // bouncing the user to the login screen.
    if (passwordRecoveryPending || passwordRecoveryError) {
      return <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} />;
    }
    if (!isAuthenticated) {
      return <Stack.Screen name="Auth" component={AuthNavigator} />;
    }
    if (!hasHousehold) {
      return <Stack.Screen name="CreateHouseholdFlow" component={CreateHouseholdNavigator} />;
    }
    // Wait for onboarding check to resolve before showing either wizard or main.
    // Render a neutral loading screen to prevent flashing Main on slow devices.
    if (onboardingCompleted === null) {
      return <Stack.Screen name="Auth" component={LoadingSplash} />;
    }
    if (!onboardingCompleted) {
      return <Stack.Screen name="Onboarding" component={OnboardingNavigator} />;
    }
    return <Stack.Screen name="Main" component={MainTabNavigator} />;
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        // REG-10: flush a notification target that arrived (cold start, or a
        // warm-start tap that beat the container) before this was ready.
        const pending = pendingNotificationTargetRef.current;
        if (pending) {
          pendingNotificationTargetRef.current = null;
          navigateToTarget(pending);
        }
      }}
    >
      {/*
        UX2-3: ConfirmDialogHost and ToastHost each mount exactly ONCE, here
        at the root — unconditionally, regardless of which branch
        `renderNavigator` returns. They used to also be mounted inside
        MainTabNavigator (guarded by a `!mainIsActive` check here to avoid
        double-mounting while Main was showing), but that left every toast
        enqueued from OUTSIDE the five main tabs — JoinHousehold's wrong
        invite code, CreateHousehold/HouseholdMembers errors, SlipCapture,
        onboarding notices — with nowhere to render.
      */}
      <ConfirmDialogHost />
      <ToastHost />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {renderNavigator()}
        <Stack.Screen
          name="HouseholdPicker"
          component={HouseholdPickerScreen}
          options={{
            title: 'Your Households',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="CreateHousehold"
          component={CreateHouseholdScreen}
          options={{
            title: 'New Household',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="HouseholdMembers"
          component={HouseholdMembersScreen}
          options={{
            title: 'Household members',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="ShareInvite"
          component={ShareInviteScreen}
          options={{
            title: 'Invite Member',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="JoinHousehold"
          component={JoinHouseholdScreen}
          options={{
            title: 'Join a Household',
            headerShown: true,
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.onSurface,
          }}
        />
        <Stack.Screen
          name="SlipScanning"
          component={SlipScanningScreen}
          options={{ headerShown: false, presentation: 'modal' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
