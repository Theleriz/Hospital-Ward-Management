// Small building blocks shared by the screens built with HeroUI.

import { Alert, AlertDialog, Button, Card, Skeleton } from "@heroui/react";
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

/** Grey outline of a screen while its data loads: counters on top, then cards. */
export function ScreenSkeleton({ stats = 4, cards = 2 }: { stats?: number; cards?: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Загрузка">
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: stats }, (_, i) => (
            <Card key={i}>
              <Card.Content className="flex flex-col gap-2.5">
                <Skeleton className="h-3 w-24 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-lg" />
                <Skeleton className="h-3 w-32 rounded-full" />
              </Card.Content>
            </Card>
          ))}
        </div>
      )}
      {Array.from({ length: cards }, (_, i) => (
        <Card key={i}>
          <Card.Content className="flex flex-col gap-3">
            <Skeleton className="h-5 w-48 rounded-lg" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-3/4 rounded-xl" />
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}

/** "Are you sure?" for actions that cannot be undone in one click (discharge, badge reissue). */
export function ConfirmDialog({
  isOpen,
  onOpenChange,
  title,
  children,
  confirmLabel,
  busyLabel,
  busy = false,
  onConfirm,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busyLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={(open) => !busy && onOpenChange(open)} className="backdrop-blur-sm">
      <AlertDialog.Container size="sm">
        <AlertDialog.Dialog>
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{title}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body className="text-sm text-[var(--muted)]">{children}</AlertDialog.Body>
          <AlertDialog.Footer>
            <Button variant="secondary" autoFocus isDisabled={busy} onPress={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button variant="danger" isDisabled={busy} onPress={onConfirm}>
              {busy && busyLabel ? busyLabel : confirmLabel}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}
