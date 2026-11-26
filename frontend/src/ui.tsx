// Small building blocks shared by the screens built with HeroUI.

import { Alert, Card } from "@heroui/react";
import type { ReactNode } from "react";

export type Tone = "ok" | "warn" | "down";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-[var(--ok)]",
  warn: "text-[var(--warn)]",
  down: "text-[var(--down)]",
};

/** A number with a caption: counters at the top of a screen. */
export function StatCard({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <Card>
      <Card.Content className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</span>
        <span className={`text-3xl font-bold tabular-nums ${tone ? TONE_TEXT[tone] : "text-[var(--text)]"}`}>{value}</span>
        {sub && <span className="text-xs text-[var(--muted)]">{sub}</span>}
      </Card.Content>
    </Card>
  );
}

/** Result of an action: green "status" or red "alert" (screen readers announce both). */
export function Notice({ kind, children }: { kind: "ok" | "error"; children: ReactNode }) {
  return (
    <Alert status={kind === "error" ? "danger" : "success"} role={kind === "error" ? "alert" : "status"}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{children}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

export function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Round avatar with the person's initials. */
export function Initials({ name, size = "md" }: { name: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] font-bold text-[var(--accent)] ${
        size === "lg" ? "size-12 text-base" : "size-9 text-xs"
      }`}
    >
      {initials(name)}
    </span>
  );
}
