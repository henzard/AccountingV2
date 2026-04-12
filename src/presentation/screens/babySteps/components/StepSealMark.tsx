/**
 * StepSealMark — SVG seal glyph for each of the 7 Baby Steps.
 *
 * Props:
 *   stepNumber: 1–7 — determines the glyph shape
 *   state: 'future' | 'current' | 'complete' — drives fill/stroke treatment
 *   size: number — width and height in logical pixels
 *
 * Visual identity (spec §Step seals):
 *   Complete  — filled brand accent, white glyph
 *   Current   — outlined brand accent, accent glyph
 *   Future    — outlined muted, muted glyph
 *
 * Consistent stroke weight (2px logical), single brand accent.
 * Uses react-native-svg.
 */

import React from 'react';
import Svg, {
  Circle,
  Rect,
  Path,
  Line,
  G,
  Text as SvgText,
} from 'react-native-svg';
import { colours } from '../../../theme/tokens';

export type SealState = 'future' | 'current' | 'complete';

export interface StepSealMarkProps {
  stepNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  state: SealState;
  size: number;
}

function getSealColours(state: SealState): {
  bg: string;
  stroke: string;
  glyph: string;
} {
  switch (state) {
    case 'complete':
      return {
        bg: colours.primary,
        stroke: colours.primary,
        glyph: colours.onPrimary,
      };
    case 'current':
      return {
        bg: 'transparent',
        stroke: colours.primary,
        glyph: colours.primary,
      };
    case 'future':
      return {
        bg: 'transparent',
        stroke: colours.outlineVariant,
        glyph: colours.outlineVariant,
      };
  }
}

/**
 * Each glyph is drawn in a 24×24 coordinate space, then scaled to `size`.
 * All paths use stroke-width=2 (before scaling).
 */
function StepGlyph({
  stepNumber,
  colour,
  scale,
}: {
  stepNumber: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  colour: string;
  scale: number;
}): React.JSX.Element {
  const sw = (2 / scale).toFixed(2); // stroke-width compensated for scale

  switch (stepNumber) {
    // Step 1: Envelope with "R1 000" embossed
    case 1:
      return (
        <G>
          {/* Envelope body */}
          <Rect x="3" y="7" width="18" height="13" rx="1.5"
            fill="none" stroke={colour} strokeWidth={sw} />
          {/* Envelope flap V */}
          <Path d="M3 7 L12 15 L21 7"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* "R" monogram */}
          {/* fontSize=5 is in the 24×24 internal coord space — intentionally small */}
          <SvgText x="12" y="21" textAnchor="middle"
            fontSize={5} fontWeight="bold" fill={colour}>R</SvgText>
        </G>
      );

    // Step 2: Broken chain link
    case 2:
      return (
        <G>
          {/* Left link (open) */}
          <Path d="M6 12 C6 9 9 9 9 12 C9 15 6 15 6 12"
            fill="none" stroke={colour} strokeWidth={sw} />
          {/* Right link (open) */}
          <Path d="M18 12 C18 9 15 9 15 12 C15 15 18 15 18 12"
            fill="none" stroke={colour} strokeWidth={sw} />
          {/* Break gap — diagonal slash */}
          <Line x1="10.5" y1="10.5" x2="13.5" y2="13.5"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
          <Line x1="10.5" y1="13.5" x2="13.5" y2="10.5"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
        </G>
      );

    // Step 3: Shield
    case 3:
      return (
        <G>
          <Path
            d="M12 3 L20 6.5 L20 13 C20 17.5 12 22 12 22 C12 22 4 17.5 4 13 L4 6.5 Z"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* Tick inside */}
          <Path d="M8.5 13 L11 15.5 L15.5 10"
            fill="none" stroke={colour} strokeWidth={sw}
            strokeLinecap="round" strokeLinejoin="round" />
        </G>
      );

    // Step 4: Sprouting seedling
    case 4:
      return (
        <G>
          {/* Stem */}
          <Line x1="12" y1="20" x2="12" y2="11"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
          {/* Left leaf */}
          <Path d="M12 14 C12 14 7 14 7 9 C7 9 12 9 12 14"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* Right leaf */}
          <Path d="M12 12 C12 12 17 12 17 7 C17 7 12 7 12 12"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* Ground line */}
          <Line x1="9" y1="20" x2="15" y2="20"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
        </G>
      );

    // Step 5: Graduation mortarboard
    case 5:
      return (
        <G>
          {/* Board top */}
          <Path d="M12 5 L22 10 L12 15 L2 10 Z"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* Cap body */}
          <Path d="M7 12.5 L7 17 C7 17 12 20 17 17 L17 12.5"
            fill="none" stroke={colour} strokeWidth={sw} strokeLinejoin="round" />
          {/* Tassel */}
          <Line x1="22" y1="10" x2="22" y2="16"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
          <Circle cx="22" cy="17" r="1" fill={colour} />
        </G>
      );

    // Step 6: House key
    case 6:
      return (
        <G>
          {/* Key bow (head circle) */}
          <Circle cx="9" cy="9" r="4.5"
            fill="none" stroke={colour} strokeWidth={sw} />
          {/* Key hole */}
          <Circle cx="9" cy="9" r="1.5" fill={colour} />
          {/* Shaft */}
          <Line x1="12.5" y1="12.5" x2="20" y2="20"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
          {/* Teeth */}
          <Line x1="16.5" y1="17" x2="16.5" y2="19"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
          <Line x1="18.5" y1="19" x2="18.5" y2="21"
            stroke={colour} strokeWidth={sw} strokeLinecap="round" />
        </G>
      );

    // Step 7: Open hand (giving)
    case 7:
      return (
        <G>
          {/* Palm */}
          <Path
            d="M8 20 L8 11 C8 10 9 9 10 10 L10 15 M10 10 L10 8 C10 7 11 6.5 12 7 L12 14 M12 7 L12 6 C12 5 13 4.5 14 5 L14 13 M14 5 L14 6 C14 5 15 4.5 16 5 L16 12 C16 14 17 15 17 17 L17 20"
            fill="none" stroke={colour} strokeWidth={sw}
            strokeLinecap="round" strokeLinejoin="round" />
        </G>
      );
  }
}

export const StepSealMark: React.FC<StepSealMarkProps> = ({ stepNumber, state, size }) => {
  const { bg, stroke, glyph } = getSealColours(state);
  const r = size / 2;
  const sw = Math.max(1.5, size / 16);
  // Glyph uses 24×24 internal coordinate space
  const scale = size / 24;

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} accessibilityLabel={`Step ${stepNumber} seal`}>
      {/* Outer circle */}
      <Circle
        cx={r}
        cy={r}
        r={r - sw / 2}
        fill={bg}
        stroke={stroke}
        strokeWidth={sw}
      />
      {/* Inner glyph — translate+scale to centre in the circle */}
      <G transform={`translate(${r - 12 * scale}, ${r - 12 * scale}) scale(${scale})`}>
        <StepGlyph stepNumber={stepNumber} colour={glyph} scale={scale} />
      </G>
    </Svg>
  );
};
