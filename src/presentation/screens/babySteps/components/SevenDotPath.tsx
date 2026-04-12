/**
 * SevenDotPath — 7-node visual progress path for Baby Steps.
 *
 * Full layout (width >= 360dp):
 *   - 7 circular nodes connected by a thin horizontal line.
 *   - Complete: filled brand accent + check glyph.
 *   - Current: larger outlined accent, 2s opacity pulse 0.6↔1.0.
 *   - Future: outlined muted, no glyph.
 *
 * Compact fallback (width < 360dp):
 *   - Text: "Step X of 7 · <title>"
 *   - Dot ratio: filled/empty Unicode dots e.g. ●●●○○○○
 *
 * Spec §Visual Identity — Dashboard card.
 * Spec §Accessibility — accessibilityLabel on the container.
 */

import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  useWindowDimensions,
  AccessibilityInfo,
} from 'react-native';
import { Text } from 'react-native-paper';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colours, spacing } from '../../../theme/tokens';
import type { BabyStepStatus } from '../../../../domain/babySteps/types';
import { BABY_STEP_RULES } from '../../../../domain/babySteps/BabyStepRules';

const COMPACT_BREAKPOINT = 360;
const NODE_RADIUS_FUTURE = 10;
const NODE_RADIUS_CURRENT = 13;
const NODE_RADIUS_COMPLETE = 10;
const STROKE_WIDTH = 2;

export interface SevenDotPathProps {
  statuses: BabyStepStatus[];
  /** Override pulse — set true in reduced-motion contexts */
  reducedMotion?: boolean;
}

function buildDotString(statuses: BabyStepStatus[]): string {
  return statuses
    .map((s) => (s.isCompleted ? '●' : '○'))
    .join('');
}

function getCurrentStepTitle(statuses: BabyStepStatus[]): { stepNumber: number; title: string } {
  const current = statuses.find((s) => !s.isCompleted);
  if (!current) {
    return { stepNumber: 7, title: BABY_STEP_RULES[7].shortTitle };
  }
  return {
    stepNumber: current.stepNumber,
    title: BABY_STEP_RULES[current.stepNumber as keyof typeof BABY_STEP_RULES].shortTitle,
  };
}

/** Single animated node for the "current" state */
function CurrentNodeSvg({ cx, cy, r }: { cx: number; cy: number; r: number }): React.JSX.Element {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.6,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 1.0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [anim]);

  return (
    <Animated.View style={{ opacity: anim, position: 'absolute', left: cx - r, top: cy - r }}>
      <Svg width={r * 2} height={r * 2} viewBox={`0 0 ${r * 2} ${r * 2}`}>
        <Circle
          cx={r}
          cy={r}
          r={r - STROKE_WIDTH}
          fill="transparent"
          stroke={colours.primary}
          strokeWidth={STROKE_WIDTH}
        />
      </Svg>
    </Animated.View>
  );
}

export const SevenDotPath: React.FC<SevenDotPathProps> = ({
  statuses,
  reducedMotion: reducedMotionProp,
}) => {
  const { width: windowWidth } = useWindowDimensions();

  // ─── All hooks must be declared before any early return ──────────────────────
  const [systemReducedMotion, setSystemReducedMotion] = React.useState(false);
  React.useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setSystemReducedMotion);
  }, []);

  const isCompact = windowWidth < COMPACT_BREAKPOINT;

  const completedCount = statuses.filter((s) => s.isCompleted).length;
  const { stepNumber: currentStepNumber, title: currentTitle } = getCurrentStepTitle(statuses);

  const a11yLabel = `Baby Steps progress: ${completedCount} of 7 steps complete, currently on Step ${currentStepNumber}`;

  // ─── Compact fallback ────────────────────────────────────────────────────────
  if (isCompact) {
    const dots = buildDotString(statuses);
    return (
      <View
        style={styles.compactContainer}
        accessible
        accessibilityLabel={a11yLabel}
      >
        <Text variant="bodySmall" style={styles.compactDots}>
          {dots}
        </Text>
        <Text variant="bodySmall" style={styles.compactText} numberOfLines={1}>
          {`Step ${currentStepNumber} of 7 · ${currentTitle}`}
        </Text>
      </View>
    );
  }

  // ─── Full layout ─────────────────────────────────────────────────────────────
  const totalNodes = 7;
  const nodeMaxR = NODE_RADIUS_CURRENT;
  const containerHeight = nodeMaxR * 2 + STROKE_WIDTH * 2;
  const paddingH = nodeMaxR; // leave space for largest possible node at edges
  const availableWidth = windowWidth - paddingH * 2 - spacing.base * 2;
  const segment = availableWidth / (totalNodes - 1);
  const cy = containerHeight / 2;

  const nodes = statuses.length === totalNodes ? statuses : Array.from({ length: totalNodes }, (_, i) => ({
    stepNumber: (i + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
    isCompleted: false,
    isManual: false,
    progress: null,
    completedAt: null,
    celebratedAt: null,
  } as BabyStepStatus));

  const currentIndex = nodes.findIndex((s) => !s.isCompleted);

  // Determine effective reducedMotion
  const noAnimation = reducedMotionProp ?? systemReducedMotion;

  return (
    <View
      style={[styles.fullContainer, { height: containerHeight + spacing.xs }]}
      accessible
      accessibilityLabel={a11yLabel}
    >
      {/* Connection line — draw behind nodes */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height={containerHeight}
      >
        {/* Full background line */}
        <Line
          x1={paddingH}
          y1={cy}
          x2={paddingH + availableWidth}
          y2={cy}
          stroke={colours.outlineVariant}
          strokeWidth={1.5}
        />
        {/* Completed segment overlay */}
        {currentIndex > 0 && (
          <Line
            x1={paddingH}
            y1={cy}
            x2={paddingH + segment * Math.max(0, currentIndex - 0.5)}
            y2={cy}
            stroke={colours.primary}
            strokeWidth={1.5}
          />
        )}
        {/* Complete nodes */}
        {nodes.map((s, i) => {
          const cx = paddingH + i * segment;
          const isCurrentNode = i === currentIndex;
          const isComplete = s.isCompleted;

          if (isComplete) {
            return (
              <React.Fragment key={s.stepNumber}>
                <Circle cx={cx} cy={cy} r={NODE_RADIUS_COMPLETE}
                  fill={colours.primary} stroke={colours.primary} strokeWidth={STROKE_WIDTH} />
                {/* Check mark */}
                <Path
                  d={`M${cx - 5} ${cy} L${cx - 1.5} ${cy + 4} L${cx + 5} ${cy - 4}`}
                  fill="none"
                  stroke={colours.onPrimary}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </React.Fragment>
            );
          }

          if (!isCurrentNode) {
            // Future
            return (
              <Circle key={s.stepNumber}
                cx={cx} cy={cy} r={NODE_RADIUS_FUTURE - STROKE_WIDTH / 2}
                fill="transparent" stroke={colours.outlineVariant} strokeWidth={STROKE_WIDTH} />
            );
          }

          return null; // Current rendered as Animated.View below
        })}
      </Svg>

      {/* Animated current node — rendered as Animated.View for opacity pulse */}
      {currentIndex >= 0 && (() => {
        const cx = paddingH + currentIndex * segment;
        const r = NODE_RADIUS_CURRENT;
        if (noAnimation) {
          // No animation — render as static SVG inline
          return (
            <Svg
              style={[StyleSheet.absoluteFill]}
              width="100%"
              height={containerHeight}
            >
              <Circle
                cx={cx}
                cy={cy}
                r={r - STROKE_WIDTH}
                fill="transparent"
                stroke={colours.primary}
                strokeWidth={STROKE_WIDTH}
              />
            </Svg>
          );
        }
        return <CurrentNodeSvg key="current-node" cx={cx} cy={cy} r={r} />;
      })()}
    </View>
  );
};

const styles = StyleSheet.create({
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  compactDots: {
    color: colours.primary,
    letterSpacing: 1,
  },
  compactText: {
    color: colours.onSurfaceVariant,
    flex: 1,
  },
  fullContainer: {
    position: 'relative',
    marginHorizontal: spacing.base,
  },
});
