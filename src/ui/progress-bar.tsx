import { Box, Text } from "ink";
import { TUI_COLOR } from "./tui-theme.js";

interface ProgressBarProps {
  /** 0–1 fraction */
  progress: number;
  width: number;
  color?: string;
  bgColor?: string;
  showPercent?: boolean;
}

const FULL_BLOCK = "\u2588";
const LIGHT_SHADE = "\u2591";

export function ProgressBar({
  progress,
  width,
  color = TUI_COLOR.accent,
  bgColor = TUI_COLOR.rule,
  showPercent = true,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, progress));
  const label = showPercent ? ` ${Math.round(pct * 100)}%` : "";
  const barWidth = Math.max(1, width - (showPercent ? 5 : 0));
  const filled = Math.round(barWidth * pct);
  const empty = barWidth - filled;

  return (
    <Box>
      <Text color={color}>{FULL_BLOCK.repeat(filled)}</Text>
      <Text color={bgColor}>{LIGHT_SHADE.repeat(empty)}</Text>
      {showPercent ? (
        <Text color={TUI_COLOR.text} bold>
          {label}
        </Text>
      ) : null}
    </Box>
  );
}
