/**
 * HeroSummaryCard — PULSE dashboard hero card.
 *
 * Adapts surface treatment to color scheme:
 *  - Dark: frosted glass (transparent bg + white border)
 *  - Light: solid dark-teal card (high-contrast anchor on warm grey bg)
 */

import React from 'react';
import { View, StyleSheet, Text, useColorScheme, type TextStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { CurrencyText } from '../../../components/shared/CurrencyText';
import { radius, spacing, fontSize } from '../../../theme/tokens';

// ─── PULSE shared palette (exported so sibling components stay consistent) ────
export const P = {
  // text
  heroText: '#E2F5EC',
  heroMuted: 'rgba(160,210,190,0.50)',
  // accent
  accent: '#00D68F',
  accentDim: 'rgba(0,214,143,0.50)',
  // dark surfaces
  cardBgDark: 'rgba(255,255,255,0.05)',
  cardBorderDark: 'rgba(255,255,255,0.09)',
  // light surfaces
  cardBgLight: '#0E2B24',
  tileBgLight: '#FFFFFF',
  tileBorderLight: '#E2EBE8',
  screenBgLight: '#F2F5F3',
  // dark tile surfaces
  tileBgDark: 'rgba(255,255,255,0.04)',
  tileBorderDark: 'rgba(255,255,255,0.07)',
  // shared
  divider: 'rgba(255,255,255,0.07)',
  statLabel: 'rgba(160,210,190,0.40)',
  statValue: 'rgba(200,235,220,0.85)',
  scoreBg: 'rgba(0,214,143,0.08)',
  scoreBorder: 'rgba(0,214,143,0.15)',
  amber: '#FFD000',
  amberLight: '#B26000',
  red: '#FF6B6B',
  redLight: '#C62828',
  navBgDark: 'rgba(6,20,16,0.95)',
} as const;

// ─── Arc gauge geometry ───────────────────────────────────────────────────────
const G = { size: 60, stroke: 5, r: 23 };
const GCX = G.size / 2;
const GCY = G.size / 2;
const G_CIRC = 2 * Math.PI * G.r;

function gaugeColor(pct: number): string {
  if (pct > 90) return P.red;
  if (pct > 75) return P.amber;
  return P.accent;
}

function scoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  return 'Keep going';
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  totalAllocatedCents: number;
  totalSpentCents: number;
  totalRemainingCents: number;
  daysRemaining: number;
  score: number;
  testID?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function HeroSummaryCard({
  totalAllocatedCents,
  totalSpentCents,
  totalRemainingCents,
  daysRemaining,
  score,
  testID,
}: Props): React.JSX.Element {
  const isDark = useColorScheme() === 'dark';

  const pctUsed =
    totalAllocatedCents > 0 ? Math.min(100, (totalSpentCents / totalAllocatedCents) * 100) : 0;
  const color = gaugeColor(pctUsed);
  const filled = G_CIRC * (pctUsed / 100);
  const lbl = scoreLabel(score);

  const cardStyle = isDark
    ? { backgroundColor: P.cardBgDark, borderColor: P.cardBorderDark, borderWidth: 1 }
    : { backgroundColor: P.cardBgLight };

  return (
    <View
      style={[styles.card, cardStyle]}
      testID={testID}
      accessibilityLabel={`Budget summary. Remaining ${totalRemainingCents} cents. ${Math.round(pctUsed)}% of budget used.`}
    >
      {/* ── Hero amount ─────────────────────────────────────────── */}
      <Text style={styles.heroLabel}>REMAINING THIS PERIOD</Text>
      <CurrencyText
        amountCents={totalRemainingCents}
        style={StyleSheet.flatten([
          styles.heroAmount,
          totalRemainingCents < 0 ? { color: P.red } : undefined,
        ])}
      />
      <Text style={styles.heroSub}>
        {daysRemaining > 0 ? `${daysRemaining} days remaining` : 'Last day of period'}
      </Text>

      {/* ── Divider ─────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Arc gauge + KPI stats + score badge ─────────────────── */}
      <View style={styles.arcRow}>
        {/* Circular arc */}
        <View style={styles.gaugeWrap}>
          <Svg width={G.size} height={G.size}>
            <Circle
              cx={GCX}
              cy={GCY}
              r={G.r}
              fill="none"
              stroke={P.divider}
              strokeWidth={G.stroke}
            />
            <Circle
              cx={GCX}
              cy={GCY}
              r={G.r}
              fill="none"
              stroke={color}
              strokeWidth={G.stroke}
              strokeDasharray={`${filled} ${G_CIRC}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${GCX} ${GCY})`}
            />
          </Svg>
          <View style={styles.gaugeInner} pointerEvents="none">
            <Text style={[styles.gaugePct, { color }]}>{Math.round(pctUsed)}%</Text>
            <Text style={styles.gaugeUsedLbl}>used</Text>
          </View>
        </View>

        {/* KPI stats */}
        <View style={styles.statsCol}>
          <View style={styles.statRow}>
            <Text style={styles.statLbl}>Allocated</Text>
            <CurrencyText amountCents={totalAllocatedCents} style={styles.statVal} />
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLbl}>Spent</Text>
            <CurrencyText amountCents={totalSpentCents} style={styles.statVal} />
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLbl}>Remaining</Text>
            <CurrencyText
              amountCents={totalRemainingCents}
              style={StyleSheet.flatten([
                styles.statVal,
                totalRemainingCents < 0 ? ({ color: P.red } as TextStyle) : undefined,
              ])}
            />
          </View>
        </View>

        {/* Score badge */}
        <View
          style={styles.scoreBadge}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: score }}
          accessibilityLabel={`Habit score: ${score} — ${lbl}`}
        >
          <Text style={styles.scoreNum}>{score}</Text>
          <Text style={styles.scoreLbl}>{lbl.toUpperCase()}</Text>
        </View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.base,
    borderRadius: radius.xxl,
    padding: spacing.lg,
  },
  heroLabel: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.xs,
    letterSpacing: 1.5,
    color: P.heroMuted,
    marginBottom: 6,
  },
  heroAmount: {
    fontFamily: 'Fraunces_700Bold',
    fontSize: 50,
    letterSpacing: -2,
    color: P.heroText,
    lineHeight: 54,
  },
  heroSub: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.sm,
    color: P.heroMuted,
    marginTop: 4,
    marginBottom: spacing.base,
  },
  divider: {
    height: 1,
    backgroundColor: P.divider,
    marginBottom: spacing.base,
  },
  arcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.base,
  },
  gaugeWrap: {
    width: G.size,
    height: G.size,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  gaugeInner: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugePct: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    lineHeight: 14,
  },
  gaugeUsedLbl: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: 8,
    color: P.statLabel,
    marginTop: 1,
  },
  statsCol: {
    flex: 1,
    gap: 6,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statLbl: {
    fontFamily: 'PlusJakartaSans_400Regular',
    fontSize: fontSize.xs,
    color: P.statLabel,
  },
  statVal: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: fontSize.sm,
    color: P.statValue,
    fontVariant: ['tabular-nums'],
  },
  scoreBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: P.scoreBg,
    borderWidth: 1,
    borderColor: P.scoreBorder,
    borderRadius: radius.lg,
    alignItems: 'center',
    flexShrink: 0,
    minWidth: 52,
  },
  scoreNum: {
    fontFamily: 'PlusJakartaSans_700Bold',
    fontSize: 20,
    color: P.accent,
    fontVariant: ['tabular-nums'],
  },
  scoreLbl: {
    fontFamily: 'PlusJakartaSans_500Medium',
    fontSize: 7,
    letterSpacing: 0.5,
    color: P.accentDim,
    marginTop: 2,
  },
});
