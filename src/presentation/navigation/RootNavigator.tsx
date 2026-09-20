import React, { useEffect } from 'react';
import { and, eq, isNull } from 'drizzle-orm';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import * as Notifications from 'expo-notifications';
import { format } from 'date-fns';
import { AuthNavigator } from './AuthNavigator';
import { MainTabNavigator } from './MainTabNavigator';
import { CreateHouseholdNavigator } from './CreateHouseholdNavigator';
import { OnboardingNavigator } from '../screens/auth/onboarding/OnboardingNavigator';
import { HouseholdPickerScreen } from '../screens/household/HouseholdPickerScreen';
import { CreateHouseholdScreen } from '../screens/household/CreateHouseholdScreen';
import { ShareInviteScreen } from '../screens/household/ShareInviteScreen';
import { JoinHouseholdScreen } from '../screens/household/JoinHouseholdScreen';
import { ResetPasswordScreen } from '../screens/auth/ResetPasswordScreen';
import { LoadingSplash } from '../components/shared/LoadingSplash';
import { ConfirmDialogHost } from '../components/shared/ConfirmDialogHost';
import { useAppStore } from '../stores/appStore';
import { useNotificationStore } from '../stores/notificationStore';
import { NotificationPreferencesRepository } from '../../infrastructure/notifications/NotificationPreferencesRepository';
import { LocalNotificationScheduler } from '../../infrastructure/notifications/LocalNotificationScheduler';
import { isOnboardingComplete } from '../../infrastructure/storage/onboardingFlag';
import { db } from '../../data/local/db';
import { transactions } from '../../data/local/schema';
import type { RootStackParamList } from './types';
import { SlipScanningScreen } from './SlipScanningScreen';
import { useAppTheme } from '../theme/useAppTheme';

const Stack = createNativeStackNavigator<RootStackParamList>();
const prefsRepo = new NotificationPreferencesRepository();

/**
 * VAL-12: cheap "did this household already log a transaction today?" check,
 * injected into the scheduler so `scheduleEveningLogPrompt` can skip/cancel
 * today's reminder instead of nagging a user who already logged. See the
 * caveat on `LocalNotificationScheduler`'s constructor doc — this only
 * re-evaluates whenever `RootNavigator`'s notification effect (re)runs, not
 * continuously through the day.
 */
async function hasLoggedTransactionToday(householdId: string): Promise<boolean> {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.householdId, householdId),
        eq(transactions.transactionDate, today),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  return row != null;
}

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
        params: { screen: 'Transactions', params: { screen: 'AddTransaction' } },
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

  // VAL-12: route a tap on a delivered notification to the relevant screen,
  // via `navigationRef` since this fires outside any screen's render tree.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = response.notification.request.content.data?.target;
      const route = resolveNotificationTarget(target);
      if (route && navigationRef.isReady()) {
        // `RootStackParamList.Main` is declared as `undefined` (types.ts,
        // not owned here) — it doesn't carry the `NavigatorScreenParams<...>`
        // shape react-navigation needs to type-check navigating into a
        // NESTED screen (tab -> stack -> screen), so `.navigate` rejects
        // this call as `never` at the type level even though it's the
        // documented react-navigation pattern for it (the same escape hatch
        // SlipProcessingScreen's `getParent()?.navigate('Main', {...})`
        // already uses). Cast through `unknown`, never `any`.
        const navigate = navigationRef.navigate as unknown as (
          screen: string,
          params?: object,
        ) => void;
        navigate(route.screen, route.params);
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

  // Mirrors the exact condition under which `renderNavigator` returns the
  // "Main" branch above — `MainTabNavigator` mounts its OWN `ConfirmDialogHost`
  // (alongside its tab bar), so mounting a second one here whenever Main is
  // showing would double up the confirm dialog. Every other branch (Auth,
  // CreateHouseholdFlow — the household-creation gate this was added for —,
  // the loading splash, Onboarding, ResetPassword) never mounts
  // MainTabNavigator, so this root-level host is the only one present then.
  const mainIsActive =
    !passwordRecoveryPending &&
    !passwordRecoveryError &&
    isAuthenticated &&
    hasHousehold &&
    onboardingCompleted === true;

  return (
    <NavigationContainer ref={navigationRef}>
      {!mainIsActive && <ConfirmDialogHost />}
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
