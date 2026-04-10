# AccountingV2 — Frontend Design Specification

> **Reference document for all feature plan writers.** Every screen built for AccountingV2 must comply with this specification. All design tokens, component patterns, motion principles, and layout rules are defined here. Do not invent new tokens or override the theme locally.

---

## Aesthetic Direction

**Concept: Refined Warmth**

AccountingV2 is a financial command centre for South African households. It must feel like a trusted, authoritative advisor — not a bank (cold, intimidating), not a startup fintech (sterile, chrome-and-teal monotone), not a spreadsheet.

The metaphor is a **well-kept leather journal** — substantial, personal, deliberate. Every entry matters. Nothing is wasted.

The envelope is the visual hero. A full envelope feels abundant and satisfying. An empty envelope is visually urgent without being alarming. The entire UI is built to serve this metaphor.

**Target emotion:** "I feel in control. I understand my money. This app is on my side."

---

## Typography

Two fonts. No others.

| Role | Font | Weight | Use |
|------|------|--------|-----|
| Display | `Fraunces` | 700 (Bold) | Screen titles, celebration moments, large currency amounts, Baby Step milestones |
| Body | `Plus Jakarta Sans` | 400 / 500 / 700 | All body text, labels, buttons, navigation, form fields |
| Numbers | `Plus Jakarta Sans` | 600 (tabular nums) | All currency amounts, percentages, meter readings — `fontVariant: ['tabular-nums']` |

**Rationale:**
- `Fraunces` is a "wonky" old-style variable serif — it has warmth and personality without being playful. It makes large currency amounts feel weighty and real. It is completely distinctive from the Inter/Space Grotesk monotony of AI-generated UIs.
- `Plus Jakarta Sans` is humanist, clean, and highly readable at small sizes. Excellent for Learner-level users who may have lower literacy confidence. Not overused.

**Installation (Expo):**
```bash
npx expo install @expo-google-fonts/fraunces @expo-google-fonts/plus-jakarta-sans expo-font
```

**Usage:**
```typescript
import { useFonts } from 'expo-font';
import {
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
} from '@expo-google-fonts/plus-jakarta-sans';
```

**Type Scale (in sp):**

| Token | Font | Size | Weight | Use |
|-------|------|------|--------|-----|
| `displayLarge` | Fraunces | 48sp | 700 | Month-end celebration amounts |
| `displayMedium` | Fraunces | 36sp | 700 | Envelope total, dashboard hero number |
| `headlineLarge` | Fraunces | 28sp | 700 | Screen titles |
| `headlineMedium` | Plus Jakarta Sans | 22sp | 700 | Section headings |
| `titleLarge` | Plus Jakarta Sans | 18sp | 600 | Card titles, envelope names |
| `titleMedium` | Plus Jakarta Sans | 16sp | 600 | List item titles |
| `bodyLarge` | Plus Jakarta Sans | 16sp | 400 | Primary body text |
| `bodyMedium` | Plus Jakarta Sans | 14sp | 400 | Secondary body, descriptions |
| `labelLarge` | Plus Jakarta Sans | 14sp | 600 | Buttons, tab labels |
| `labelMedium` | Plus Jakarta Sans | 12sp | 500 | Chips, badges, metadata |
| `labelSmall` | Plus Jakarta Sans | 11sp | 500 | Captions, helper text |

---

## Colour System

**Brand Palette (from PRD — fixed, no Material You dynamic colour):**

```typescript
// src/presentation/theme/tokens.ts

export const colours = {
  // Primary — Deep Teal
  primary: '#00695C',
  primaryContainer: '#E0F2F0',
  onPrimary: '#FFFFFF',
  onPrimaryContainer: '#003D35',

  // Secondary — Warm Amber
  secondary: '#FFB300',
  secondaryContainer: '#FFF8E1',
  onSecondary: '#1A1200',
  onSecondaryContainer: '#3D2C00',

  // Semantic
  success: '#2E7D32',
  successContainer: '#E8F5E9',
  onSuccess: '#FFFFFF',

  error: '#C62828',
  errorContainer: '#FFEBEE',
  onError: '#FFFFFF',

  warning: '#E65100',
  warningContainer: '#FFF3E0',
  onWarning: '#FFFFFF',

  // Surface
  surface: '#FAFAFA',
  surfaceVariant: '#F0F4F4',
  onSurface: '#1A2422',
  onSurfaceVariant: '#3D5451',

  // Background
  background: '#FAFAFA',
  outline: '#6B8A87',
  outlineVariant: '#C4D7D4',

  // Envelope fill states
  envelopeFull: '#2E7D32',      // >60% remaining — success green
  envelopeMid: '#FFB300',       // 20–60% remaining — amber
  envelopeWarning: '#E65100',   // 10–20% remaining — orange
  envelopeDanger: '#C62828',    // <10% remaining — red
  envelopeEmpty: '#E0E0E0',     // 0% remaining — neutral grey

  // Debt snowball
  debtBar: '#C62828',
  debtBarPaid: '#2E7D32',
  debtBarBackground: '#FFEBEE',

  // Score ring
  scoreExcellent: '#2E7D32',   // 80–100
  scoreGood: '#00695C',        // 60–79
  scoreFair: '#FFB300',        // 40–59
  scorePoor: '#C62828',        // 0–39

  // Overlays
  scrim: 'rgba(0, 0, 0, 0.4)',
  shimmer: 'rgba(255, 255, 255, 0.6)',
} as const;
```

**Colour Usage Rules:**
- `primary` (#00695C) — CTAs, active tabs, progress fills, focus states
- `secondary` (#FFB300) — celebration accents, streak badges, milestone markers
- `success` (#2E7D32) — positive outcomes, full envelopes, Baby Step completions
- `error` (#C62828) — envelope busts, danger warnings, debt
- Never use `primary` and `secondary` together in the same component — they clash

---

## Spacing & Layout

```typescript
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  full: 9999,
} as const;

export const elevation = {
  none: 0,
  low: 1,
  medium: 3,
  high: 6,
} as const;
```

**Screen Layout:**
- Horizontal screen padding: `spacing.base` (16dp) — consistent everywhere
- Card internal padding: `spacing.base` (16dp)
- Section gap between cards: `spacing.md` (12dp)
- Bottom safe area: always account for `useSafeAreaInsets().bottom`
- Minimum touch target: 48×48dp (NFR-A03)

---

## React Native Paper Theme

```typescript
// src/presentation/theme/theme.ts
import { MD3LightTheme, configureFonts } from 'react-native-paper';
import { colours } from './tokens';

const fontConfig = {
  displayLarge: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 48,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  displayMedium: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 36,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  headlineLarge: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 28,
    fontWeight: '700' as const,
    letterSpacing: -0.25,
  },
  headlineMedium: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: 0,
  },
  titleLarge: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 18,
    fontWeight: '600' as const,
    letterSpacing: 0,
  },
  titleMedium: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.15,
  },
  bodyLarge: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.15,
  },
  bodyMedium: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
  },
  labelLarge: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontSize: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
};

export const appTheme = {
  ...MD3LightTheme,
  fonts: configureFonts({ config: fontConfig }),
  colors: {
    ...MD3LightTheme.colors,
    primary: colours.primary,
    primaryContainer: colours.primaryContainer,
    onPrimary: colours.onPrimary,
    onPrimaryContainer: colours.onPrimaryContainer,
    secondary: colours.secondary,
    secondaryContainer: colours.secondaryContainer,
    onSecondary: colours.onSecondary,
    onSecondaryContainer: colours.onSecondaryContainer,
    error: colours.error,
    errorContainer: colours.errorContainer,
    onError: colours.onError,
    surface: colours.surface,
    surfaceVariant: colours.surfaceVariant,
    onSurface: colours.onSurface,
    onSurfaceVariant: colours.onSurfaceVariant,
    background: colours.background,
    outline: colours.outline,
    outlineVariant: colours.outlineVariant,
  },
  roundness: 3, // MD3 uses token-based rounding; Paper maps roundness to radius scale
};
```

---

## Envelope Fill Bar — The Hero Component

This is the most important visual element in the app. The `EnvelopeFillBar` must be beautiful, immediate, and emotionally resonant.

**Design spec:**
- Height: 8dp (standard) / 12dp (dashboard hero)
- Background: `colours.outlineVariant` (#C4D7D4)
- Fill: animated, colour-reactive to percentage remaining
- Animation: fill interpolates over 600ms with `Easing.out(Easing.cubic)` on mount and on balance change
- Corner radius: `radius.full` (fully rounded pill)

```typescript
// src/presentation/components/shared/EnvelopeFillBar.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colours, radius } from '../../theme/tokens';

interface Props {
  percentRemaining: number; // 0–100
  height?: number;
}

function getFillColour(pct: number): string {
  if (pct > 60) return colours.envelopeFull;
  if (pct > 20) return colours.envelopeMid;
  if (pct > 10) return colours.envelopeWarning;
  if (pct > 0) return colours.envelopeDanger;
  return colours.envelopeEmpty;
}

export function EnvelopeFillBar({ percentRemaining, height = 8 }: Props): React.JSX.Element {
  const anim = useRef(new Animated.Value(percentRemaining)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: percentRemaining,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [percentRemaining]);

  const width = anim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
    extrapolate: 'clamp',
  });

  return (
    <View style={[styles.track, { height, borderRadius: radius.full }]}>
      <Animated.View
        style={[
          styles.fill,
          {
            width,
            height,
            borderRadius: radius.full,
            backgroundColor: getFillColour(percentRemaining),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: colours.outlineVariant,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
});
```

---

## CurrencyText — The Number Display Component

Currency amounts are the most read element in the app. They must be instantly scannable.

**Rules:**
- Always receives `amountCents: number` (integer) — never a float
- Renders using `fontVariant: ['tabular-nums']` for alignment in lists
- Large amounts (displayMedium+): use Fraunces
- Body amounts (titleMedium and below): use Plus Jakarta Sans SemiBold

```typescript
// src/presentation/components/shared/CurrencyText.tsx
import React from 'react';
import { Text, StyleSheet } from 'react-native';
import type { TextStyle } from 'react-native';

interface Props {
  amountCents: number;
  style?: TextStyle;
  showSign?: boolean; // shows + for positive values
}

export function CurrencyText({ amountCents, style, showSign = false }: Props): React.JSX.Element {
  const isNegative = amountCents < 0;
  const absAmount = Math.abs(amountCents);
  const rand = (absAmount / 100).toLocaleString('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const prefix = isNegative ? '-' : showSign ? '+' : '';
  const display = `${prefix}${rand}`;

  return <Text style={[styles.base, style]}>{display}</Text>;
}

const styles = StyleSheet.create({
  base: {
    fontFamily: 'PlusJakartaSans_600SemiBold',
    fontVariant: ['tabular-nums'],
  },
});
```

---

## EnvelopeCard — Core List Item

The most frequently rendered component. Every touch must feel right.

**Design spec:**
- Background: `colours.surface` with `elevation.low` shadow
- Border radius: `radius.lg` (12dp)
- Internal padding: `spacing.base` (16dp)
- Envelope name: `titleMedium` (Plus Jakarta Sans 600, 16sp)
- Amount remaining: `titleLarge` (Plus Jakarta Sans 600, 18sp) — tabular nums
- Budget amount: `bodyMedium` (Plus Jakarta Sans 400, 14sp) in `onSurfaceVariant`
- Fill bar: 8dp height, 8dp top margin
- Percentage label: `labelSmall` right-aligned in the fill bar colour

**Interaction:**
- `activeOpacity`: 0.85 on `TouchableOpacity`
- No ripple effect (doesn't suit the refined aesthetic) — use opacity fade

---

## Navigation Shell

**Bottom Tab Bar:**
- 5 tabs: Dashboard, Transactions, Meters, Snowball, Settings
- Active tab: `primary` icon + label
- Inactive: `onSurfaceVariant` at 60% opacity
- No labels below icon — icons only (cleaner; labels available in accessibility tree)
- Exception: active tab shows a pill indicator above icon, not underlining
- Background: `colours.surface` with a subtle top border `colours.outlineVariant`

**Tab icons (use react-native-paper Icon or expo/vector-icons MaterialCommunityIcons):**

| Tab | Icon |
|-----|------|
| Dashboard | `view-dashboard-outline` / `view-dashboard` |
| Transactions | `swap-horizontal` / `swap-horizontal` |
| Meters | `lightning-bolt-outline` / `lightning-bolt` |
| Snowball | `snowflake` / `snowflake` |
| Settings | `cog-outline` / `cog` |

**Stack Headers:**
- Use React Native Paper's `Appbar.Header` with `appTheme.colors.surface` background (not primary)
- Title: `headlineMedium` (Plus Jakarta Sans Bold, 22sp) — not Fraunces for headers
- Fraunces reserved for data moments, not navigation chrome
- Back button: `Appbar.BackAction` — no custom icons
- Header elevation: 0 (flat; separation via background colour)

---

## Motion Principles

**Principle: Motion is meaning, not decoration.**

Every animation must communicate something. If removing an animation doesn't change what the user understands, it should not exist.

**Approved animations:**

| Element | Animation | Duration | Easing |
|---------|-----------|----------|--------|
| Envelope fill bar (mount) | Width 0% → value | 600ms | `Easing.out(Easing.cubic)` |
| Envelope fill bar (update) | Width interpolate | 400ms | `Easing.inOut(Easing.quad)` |
| Debt payoff bar | Width animate on payment logged | 800ms | `Easing.out(Easing.elastic(0.8))` |
| Surplus celebration screen | Scale + fade in | 500ms | Spring (`useSpring`) |
| Snackbar | Slide up from bottom | 250ms | `Easing.out(Easing.quad)` |
| Screen transitions | react-navigation default slide | Default | Default |
| Skeleton shimmer | Shimmer loop | 1200ms | Linear, infinite |
| Baby Step completion | Confetti burst + scale | 600ms | Spring |
| Ramsey Score ring | Arc draw on mount | 1000ms | `Easing.out(Easing.cubic)` |

**Forbidden animations:**
- Fade-in on every list item (distracting, no semantic meaning)
- Bounce on button tap (juvenile for a financial app)
- Parallax scroll effects (accessibility burden)
- Looping animations on resting state (exhausting to watch)

---

## Loading States

**Skeleton loaders — not spinners:**

Use skeleton loaders wherever the layout is known. Spinners only for indeterminate async operations (OCR processing, sync in progress).

**Skeleton implementation:**
```typescript
// src/presentation/components/shared/LoadingSkeletonCard.tsx
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colours, radius, spacing } from '../../theme/tokens';

export function LoadingSkeletonCard(): React.JSX.Element {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 600, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 600, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0.9] });

  return (
    <View style={styles.card}>
      <Animated.View style={[styles.titleLine, { opacity }]} />
      <Animated.View style={[styles.amountLine, { opacity }]} />
      <Animated.View style={[styles.barLine, { opacity }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colours.surface,
    borderRadius: radius.lg,
    padding: spacing.base,
    marginBottom: spacing.md,
  },
  titleLine: {
    height: 16,
    width: '60%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.sm,
    marginBottom: spacing.sm,
  },
  amountLine: {
    height: 22,
    width: '40%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  barLine: {
    height: 8,
    width: '100%',
    backgroundColor: colours.outlineVariant,
    borderRadius: radius.full,
  },
});
```

---

## Error States

**Snackbar — transient errors:**
```typescript
// src/presentation/components/shared/ErrorSnackbar.tsx
// Wraps React Native Paper Snackbar
// Duration: 4000ms
// Action text: 'Dismiss' or context-specific ('Retry', 'Edit')
// Position: bottom of screen, above bottom tab bar
// Background: colours.onSurface (near-black) for contrast
```

**Inline form errors:**
- Below field, 4dp margin top
- `labelSmall` (11sp) in `colours.error`
- Icon: `alert-circle-outline` 14dp, same colour

**Full-screen error (fatal only):**
- Centred layout
- Icon: `cloud-off-outline` or `database-off` 64dp in `onSurfaceVariant`
- Title: `headlineMedium` in `onSurface`
- Body: `bodyMedium` in `onSurfaceVariant`
- Primary button: retry action in `primary` filled button

---

## Screen Layout Patterns

**List screen (Envelope List, Transaction History):**
```
SafeAreaView
  AppBar (flat, no elevation)
  ScrollView / FlatList
    Padding: spacing.base horizontal
    Section header: labelLarge UPPERCASE in onSurfaceVariant
    Cards with spacing.md gap
  FAB (bottom-right, primary colour) — for add actions
```

**Detail screen (Envelope Detail, Debt Detail):**
```
SafeAreaView
  AppBar with back button
  ScrollView
    Hero section (large amount, fill bar) — full width, surfaceVariant background
    Stats row (budget, spent, remaining) — 3-column
    Divider
    Transaction list — labelled section
```

**Dashboard (most important screen):**
```
SafeAreaView
  AppBar with household name + sync status icon
  ScrollView
    Period header (e.g. "20 Mar – 19 Apr") — labelMedium, amber
    Remaining total — displayMedium Fraunces in primary
    Savings locked indicator — labelMedium in successContainer
    Envelope cards — FlatList (not nested ScrollView)
    Ramsey Score card — circular ring + score number
    Baby Step progress — compact horizontal stepper
```

---

## Celebration Moments

Three distinct celebration tiers:

**Tier 1 — Envelope surplus (end of period):**
- Full-screen overlay (semi-transparent scrim over dashboard)
- Large ✓ in success green, scale spring animation
- Fraunces amount saved (displayMedium)
- "Well done." in bodyLarge (understated — Dave Ramsey approved)
- Three routing buttons: Save more, Snowball, Carry forward

**Tier 2 — Baby Step completion:**
- Full-screen dedicated screen
- Amber confetti particles (use `react-native-confetti-cannon` or simple View-based particles)
- Step number in displayLarge Fraunces
- Step name in headlineLarge
- Share button (optional) + Continue button

**Tier 3 — Debt cleared (snowball milestone):**
- In-screen animation only — no separate screen
- Debt payoff bar animates to 100% → turns success green → bar collapses with spring
- "PAID OFF" badge appears over the bar in bold labelLarge
- Brief haptic feedback (`expo-haptics` — `ImpactFeedbackStyle.Medium`)

---

## Accessibility Implementation

All components must satisfy NFR-A01 through NFR-A06:

```typescript
// Minimum touch target wrapper — use for any interactive element under 48dp
<TouchableOpacity
  style={{ minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' }}
  accessible={true}
  accessibilityLabel="Transfer funds from Groceries envelope"
  accessibilityRole="button"
>
```

**Colour contrast verification (WCAG AA):**
- `onSurface` (#1A2422) on `surface` (#FAFAFA): ratio ~16:1 ✓
- `primary` (#00695C) on `surface` (#FAFAFA): ratio ~5.5:1 ✓ (just above 4.5:1 threshold)
- `secondary` (#FFB300) on `surface` (#FAFAFA): ratio ~2.6:1 ✗ — **never use amber as text colour on white**
- `secondary` on `onSurface` (#1A2422): ratio ~8.9:1 ✓ — amber on dark background is acceptable

**Rule:** Amber is an accent/highlight colour only — icons, badges, underlines. Never amber text on a light background.

---

## File Locations

| File | Path |
|------|------|
| Design tokens | `src/presentation/theme/tokens.ts` |
| React Native Paper theme | `src/presentation/theme/theme.ts` |
| Font loading hook | `src/presentation/theme/useFonts.ts` |
| EnvelopeFillBar | `src/presentation/components/shared/EnvelopeFillBar.tsx` |
| CurrencyText | `src/presentation/components/shared/CurrencyText.tsx` |
| DateText | `src/presentation/components/shared/DateText.tsx` |
| LoadingSkeletonCard | `src/presentation/components/shared/LoadingSkeletonCard.tsx` |
| ErrorSnackbar | `src/presentation/components/shared/ErrorSnackbar.tsx` |
| ConfirmDialog | `src/presentation/components/shared/ConfirmDialog.tsx` |
| BabyStepProgressBar | `src/presentation/components/shared/BabyStepProgressBar.tsx` |

---

## What Feature Plan Writers Must Do

Every feature plan that adds screens must:

1. Import tokens from `src/presentation/theme/tokens.ts` — never hardcode colours or spacing
2. Use `CurrencyText` for all ZAR amounts — never format currency manually in a screen
3. Use `DateText` for all date rendering — never call `toLocaleDateString()`
4. Use `EnvelopeFillBar` for all balance indicators
5. Use `LoadingSkeletonCard` during loading states — not `ActivityIndicator` for list content
6. Use `ErrorSnackbar` for transient errors — not `Alert.alert()`
7. Define `accessibilityLabel` on all interactive elements
8. Ensure all touch targets are ≥ 48×48dp
9. Use `useSafeAreaInsets()` at screen root — no hardcoded bottom padding
10. Follow the screen layout patterns above for list, detail, and dashboard screens
