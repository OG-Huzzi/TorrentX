import { Text, useInput } from "ink";
import { useEffect, useState } from "react";
import { TUI_COLOR } from "./tui-theme.js";

interface TextFieldProps {
  value: string;
  onChange(value: string): void;
  onSubmit(value: string): void;
  onCancel?: () => void;
  active: boolean;
  width: number;
  placeholder: string;
}

export function TextField({
  value,
  onChange,
  onSubmit,
  onCancel,
  active,
  width,
  placeholder,
}: TextFieldProps) {
  const [cursor, setCursor] = useState(value.length);

  useEffect(() => setCursor((current) => Math.min(current, value.length)), [value]);

  useInput(
    (input, key) => {
      if (key.return) {
        onSubmit(value);
        return;
      }
      if (key.escape) {
        onCancel?.();
        return;
      }
      if (key.leftArrow || (key.ctrl && input === "b")) {
        setCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.rightArrow || (key.ctrl && input === "f")) {
        setCursor((current) => Math.min(value.length, current + 1));
        return;
      }
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "e") {
        setCursor(value.length);
        return;
      }
      if (key.ctrl && input === "u") {
        onChange(value.slice(cursor));
        setCursor(0);
        return;
      }
      if (key.ctrl && input === "w") {
        const before = value.slice(0, cursor);
        const start = before.search(/\S+\s*$/);
        if (start >= 0) {
          onChange(value.slice(0, start) + value.slice(cursor));
          setCursor(start);
        }
        return;
      }
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          onChange(value.slice(0, cursor - 1) + value.slice(cursor));
          setCursor((current) => current - 1);
        }
        return;
      }
      if (key.ctrl || key.meta || !input) return;
      const printable = input.replace(/[\x00-\x1f\x7f]/g, "");
      if (!printable) return;
      onChange(value.slice(0, cursor) + printable + value.slice(cursor));
      setCursor((current) => current + printable.length);
    },
    { isActive: active },
  );

  if (!value) {
    if (!active) return <Text dimColor>{placeholder}</Text>;
    return (
      <Text>
        <Text inverse>{placeholder.charAt(0) || " "}</Text>
        <Text dimColor>{placeholder.slice(1)}</Text>
      </Text>
    );
  }

  const available = Math.max(4, width);
  const start = Math.max(0, Math.min(cursor - available + 2, value.length - available));
  const visible = value.slice(start, start + available);
  const localCursor = cursor - start;
  const before = visible.slice(0, localCursor);
  const at = visible.charAt(localCursor) || " ";
  const after = visible.slice(localCursor + (at === " " && localCursor >= visible.length ? 0 : 1));

  return (
    <Text color={TUI_COLOR.text}>
      {start > 0 ? "..." : ""}
      {before}
      {active ? <Text inverse>{at}</Text> : at.trimEnd()}
      {after}
    </Text>
  );
}
