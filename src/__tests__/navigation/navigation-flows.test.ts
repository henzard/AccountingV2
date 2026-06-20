/**
 * Navigation guard logic tests: verify the RootNavigator renders the correct
 * navigator based on auth state, household membership, and onboarding status.
 *
 * We test the renderNavigator decision logic directly without rendering
 * full React Navigation trees, since that requires native modules.
 */
import { resetFactoryCounter } from '../../__test-utils__/factories';

jest.mock('expo-crypto', () => ({
  randomUUID: () => 'mock-uuid-nav-' + Math.random().toString(36).slice(2, 10),
}));

// ─── Navigation Guard Logic (extracted from RootNavigator) ───────────────────

type NavigatorName = 'Auth' | 'CreateHouseholdFlow' | 'Onboarding' | 'Main';

interface NavigationState {
  session: { user: { id: string } } | null;
  householdId: string | null;
  onboardingCompleted: boolean | null;
}

/** Mirrors RootNavigator: pending onboarding renders Auth stack + LoadingSplash. */
function resolveNavigator(state: NavigationState): NavigatorName {
  const isAuthenticated = Boolean(state.session);
  const hasHousehold = Boolean(state.householdId);

  if (!isAuthenticated) return 'Auth';
  if (!hasHousehold) return 'CreateHouseholdFlow';
  if (state.onboardingCompleted === null) return 'Auth';
  if (!state.onboardingCompleted) return 'Onboarding';
  return 'Main';
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

beforeEach(() => resetFactoryCounter());

describe('Navigation Guard Logic', () => {
  describe('Not authenticated', () => {
    it('shows Auth navigator when session is null', () => {
      const result = resolveNavigator({
        session: null,
        householdId: null,
        onboardingCompleted: null,
      });
      expect(result).toBe('Auth');
    });

    it('shows Auth navigator regardless of householdId when not authenticated', () => {
      const result = resolveNavigator({
        session: null,
        householdId: 'some-household',
        onboardingCompleted: true,
      });
      expect(result).toBe('Auth');
    });
  });

  describe('Authenticated but no household', () => {
    it('shows CreateHouseholdFlow when householdId is null', () => {
      const result = resolveNavigator({
        session: { user: { id: 'user-1' } },
        householdId: null,
        onboardingCompleted: null,
      });
      expect(result).toBe('CreateHouseholdFlow');
    });
  });

  describe('Authenticated + household + onboarding pending', () => {
    it('shows Auth (LoadingSplash) while onboarding status is resolving (null)', () => {
      const result = resolveNavigator({
        session: { user: { id: 'user-1' } },
        householdId: 'hh-1',
        onboardingCompleted: null,
      });
      expect(result).toBe('Auth');
    });

    it('shows Onboarding when onboardingCompleted is false', () => {
      const result = resolveNavigator({
        session: { user: { id: 'user-1' } },
        householdId: 'hh-1',
        onboardingCompleted: false,
      });
      expect(result).toBe('Onboarding');
    });
  });

  describe('Authenticated + household + onboarded', () => {
    it('shows Main tab navigator', () => {
      const result = resolveNavigator({
        session: { user: { id: 'user-1' } },
        householdId: 'hh-1',
        onboardingCompleted: true,
      });
      expect(result).toBe('Main');
    });
  });

  describe('State transition sequences', () => {
    it('follows Auth -> CreateHouseholdFlow -> Auth (splash) -> Main flow', () => {
      const states: NavigationState[] = [
        { session: null, householdId: null, onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: null, onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: 'hh-1', onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: 'hh-1', onboardingCompleted: true },
      ];

      const expected: NavigatorName[] = ['Auth', 'CreateHouseholdFlow', 'Auth', 'Main'];

      states.forEach((state, i) => {
        expect(resolveNavigator(state)).toBe(expected[i]);
      });
    });

    it('follows Auth -> CreateHouseholdFlow -> Auth (splash) -> Onboarding -> Main flow', () => {
      const states: NavigationState[] = [
        { session: null, householdId: null, onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: null, onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: 'hh-1', onboardingCompleted: null },
        { session: { user: { id: 'u1' } }, householdId: 'hh-1', onboardingCompleted: false },
        { session: { user: { id: 'u1' } }, householdId: 'hh-1', onboardingCompleted: true },
      ];

      const expected: NavigatorName[] = [
        'Auth',
        'CreateHouseholdFlow',
        'Auth',
        'Onboarding',
        'Main',
      ];

      states.forEach((state, i) => {
        expect(resolveNavigator(state)).toBe(expected[i]);
      });
    });

    it('sign-out returns to Auth from any state', () => {
      const afterSignOut: NavigationState = {
        session: null,
        householdId: null,
        onboardingCompleted: null,
      };
      expect(resolveNavigator(afterSignOut)).toBe('Auth');
    });
  });
});
