// Form building blocks of the HeroUI screens: text and number fields, drop-downs,
// check boxes and choice cards, plus the card layout of the device simulators.
// Every control keeps a visible label, so screen readers and the end-to-end tests
// find it by name.

import { Card, Input, Label, ListBox, Select, TextField } from "@heroui/react";
import type { FormEvent, ReactNode } from "react";

/** HeroUI Select keys cannot be empty: "" (nothing chosen) travels as this key */
const NONE = "__none__";

export function Hint({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`m-0 text-xs text-[var(--muted)] ${className}`}>{children}</p>;
}

/** Text, number, date or phone field with its label (and an optional hint under it). */
export function Field({
  label,
  value,
  onChange,
  type = "text",
  min,
  max,
  step,
  isRequired,
  isDisabled,
  placeholder,
  maxLength,
  hint,
  className,
}: {
  label: string;
  value: string | number | null;
  onChange: (text: string) => void;
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <TextField
      type={type}
      value={value === null ? "" : String(value)}
      onChange={onChange}
      isRequired={isRequired}
      isDisabled={isDisabled}
      maxLength={maxLength}
      className={className}
      fullWidth
    >
      <Label>{label}</Label>
      <Input min={min} max={max} step={step} placeholder={placeholder} />
      {hint && <Hint className="mt-1">{hint}</Hint>}
    </TextField>
  );
}

/** Drop-down with its label. Options are [value, label]; "" is a valid value. */
export function ChoiceField<T extends string>({
  label,
  value,
  onChange,
  options,
  isRequired,
  isDisabled,
  placeholder,
  hint,
  className,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, string])[];
  isRequired?: boolean;
  isDisabled?: boolean;
  placeholder?: string;
  hint?: ReactNode;
  className?: string;
}) {
  const toKey = (v: string) => (v === "" ? NONE : v);
  return (
    <Select
      selectedKey={value === "" && !options.some(([v]) => v === "") ? null : toKey(value)}
      onSelectionChange={(key) => key !== null && onChange((key === NONE ? "" : String(key)) as T)}
      isRequired={isRequired}
      isDisabled={isDisabled}
      placeholder={placeholder}
      className={className}
      fullWidth
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([v, text]) => (
            <ListBox.Item key={toKey(v)} id={toKey(v)} textValue={text}>
              {text}
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {hint && <Hint className="mt-1">{hint}</Hint>}
    </Select>
  );
}

/** Check box with its text. A native input: the browser keeps keyboard and form behaviour. */
export function CheckField({
  checked,
  onChange,
  isDisabled,
  children,
  className = "",
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  isDisabled?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer flex-row items-start gap-3 text-sm font-normal text-[var(--text)] ${
        isDisabled ? "cursor-not-allowed opacity-50" : ""
      } ${className}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={isDisabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer rounded p-0 accent-[var(--accent)]"
      />
      <span>{children}</span>
    </label>
  );
}

export type Choice<T extends string> = { value: T; label: ReactNode; hint?: ReactNode };

/** One-of-many choice drawn as cards (role radio): the label and a short hint. */
export function ChoiceCards<T extends string>({
  label,
  value,
  onChange,
  choices,
  isDisabled,
  className = "",
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  choices: Choice<T>[];
  isDisabled?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={`m-0 flex min-w-0 flex-col gap-2 border-0 p-0 ${className}`}>
      <legend className="mb-2 p-0 text-sm font-medium text-[var(--text)]">{label}</legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2" role="radiogroup" aria-label={label}>
        {choices.map((c) => {
          const active = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={isDisabled}
              onClick={() => onChange(c.value)}
              className={`flex min-h-0 flex-col items-start gap-1 rounded-xl border-2 px-3 py-2.5 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                active
                  ? "border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--text)] hover:bg-[var(--accent-bg)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]"
              }`}
            >
              {c.label}
              {c.hint && <span className="text-xs font-normal text-[var(--muted)]">{c.hint}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Main form card of a simulator: title, then a two-column grid of fields. */
export function FormCard({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (event: FormEvent) => void;
  children: ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <Card.Header>
        <Card.Title render={(props) => <h2 {...props} />}>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
          {children}
        </form>
      </Card.Content>
    </Card>
  );
}

/** Spans both columns of a FormCard grid */
export function Wide({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`md:col-span-2 ${className}`}>{children}</div>;
}

/** Explanation card at the side of a simulator. */
export function SideCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="h-fit">
      <Card.Header>
        <Card.Title render={(props) => <h2 {...props} />}>{title}</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3 text-sm text-[var(--muted)]">{children}</Card.Content>
    </Card>
  );
}

export function SimLayout({ children }: { children: ReactNode }) {
  return <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">{children}</div>;
}

/** Result block inside a simulator form */
export function ResultPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-sm text-[var(--text)] md:col-span-2"
      aria-live="polite"
    >
      <h3 className="m-0 text-base font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** Points per measurement */
export function ScoreTable({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-[var(--surface-2)]">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Показатель</th>
            <th className="px-4 py-2 text-right text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">Баллы</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, points]) => (
            <tr key={name} className="border-t border-[var(--border)]">
              <td className="px-4 py-2">{name}</td>
              <td className="px-4 py-2 text-right font-semibold tabular-nums">{points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
