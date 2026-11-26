import { Alert, Button, Card, Input, Label, TextField } from "@heroui/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError, getLoginOptions, login, type User } from "./api";
import CameraScanner from "./CameraScanner";
import { BadgeIcon, ClockIcon, LogoMark, PostIcon, WardsIcon } from "./icons";

// Badge reader works like a keyboard: it types the badge ID and presses Enter.
// Enter in the badge field moves on to the PIN instead of submitting the form.
// Without a reader, the camera reads the barcode on the badge. The PIN is
// needed: a photo of a barcode must not be enough to log in. Only in the demo
// mode (MEDBASE_DEMO_BADGE_LOGIN on the server) the badge alone logs in at once.

const POINTS = [
  { icon: WardsIcon, text: "Занятость палат и движение пациентов в одном месте" },
  { icon: PostIcon, text: "Оповещения мониторов и кнопок вызова на посту за секунду" },
  { icon: ClockIcon, text: "Неподтверждённый срочный вызов через 30 секунд уходит свободной медсестре" },
];

export default function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [badgeId, setBadgeId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [badgeOnly, setBadgeOnly] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);
  const badgeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getLoginOptions()
      .then((options) => setBadgeOnly(options.badge_only))
      .catch(() => setBadgeOnly(false));
  }, []);

  const signIn = useCallback(
    async (badge: string, withPin: string | null) => {
      setError(null);
      setSubmitting(true);
      try {
        onLogin(await login(badge.trim(), withPin));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Сервер недоступен");
        setPin("");
        (withPin === null ? badgeRef : pinRef).current?.focus();
      } finally {
        setSubmitting(false);
      }
    },
    [onLogin],
  );

  const onScanned = useCallback(
    (text: string) => {
      const badge = text.slice(0, 32);
      setBadgeId(badge);
      setError(null);
      setScanning(false);
      if (badgeOnly) {
        void signIn(badge, null);
        return;
      }
      // After the dialog has closed and given focus back
      requestAnimationFrame(() => pinRef.current?.focus());
    },
    [badgeOnly, signIn],
  );

  function onBadgeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // In the demo mode Enter from the reader submits the form: there is no PIN
    if (event.key === "Enter" && !badgeOnly) {
      event.preventDefault();
      pinRef.current?.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await signIn(badgeId, badgeOnly ? null : pin);
  }

  return (
    <div className="grid min-h-screen bg-[var(--bg)] lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-[var(--sidebar)] px-14 py-12 text-[var(--sidebar-text)] lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-[var(--brand)] opacity-25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-48 -left-32 size-[440px] rounded-full bg-sky-500 opacity-15 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <LogoMark size={44} />
          <div className="flex flex-col">
            <strong className="text-xl text-white">MedBase</strong>
            <span className="text-sm text-[var(--sidebar-muted)]">Hospital Ward Management</span>
          </div>
        </div>

        <div className="relative my-auto flex max-w-xl flex-col gap-8 py-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white">
            Отделение под контролем: койки, вызовы и реакция персонала
          </h1>
          <ul className="flex flex-col gap-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-4 text-base">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#5fd3c9] ring-1 ring-white/10">
                  <Icon size={22} />
                </span>
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-sm text-[var(--sidebar-muted)]">Team MedBase · внутренняя сеть отделения</p>
      </section>

      {/* Sign-in */}
      <section className="flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md p-8 shadow-xl">
          <form className="flex flex-col gap-5" onSubmit={onSubmit}>
            <div className="flex items-center gap-3 lg:hidden">
              <LogoMark size={36} />
              <strong className="text-lg text-[var(--text)]">MedBase</strong>
            </div>

            <span className="flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-bg)] text-[var(--accent)]">
              <BadgeIcon size={24} />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="m-0 text-2xl font-bold text-[var(--text)]">Вход по бейджу</h2>
              <p className="m-0 text-sm text-[var(--muted)]">
                Отсканируйте штрих-код бейджа сканером или камерой либо введите номер, затем PIN.
              </p>
            </div>

            <TextField
              name="badge"
              value={badgeId}
              onChange={setBadgeId}
              isRequired
              maxLength={32}
              autoComplete="off"
              fullWidth
            >
              <Label>Бейдж</Label>
              <Input ref={badgeRef} placeholder="BADGE-1001" onKeyDown={onBadgeKeyDown} autoFocus />
            </TextField>

            <Button variant="secondary" fullWidth onPress={() => setScanning(true)}>
              Сканировать камерой
            </Button>

            {badgeOnly ? (
              <Alert status="warning" role="status">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>Демо-режим: вход только по бейджу, без PIN. Не для реальной работы.</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : (
              <TextField
                name="pin"
                type="password"
                value={pin}
                onChange={setPin}
                isRequired
                pattern="\d{4,8}"
                maxLength={8}
                autoComplete="off"
                fullWidth
              >
                <Label>PIN</Label>
                <Input ref={pinRef} inputMode="numeric" title="4–8 цифр" placeholder="••••" />
              </TextField>
            )}

            {error && (
              <Alert status="danger" role="alert">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <Button type="submit" fullWidth size="lg" isDisabled={submitting}>
              {submitting ? "Вход…" : "Войти"}
            </Button>
          </form>
        </Card>
      </section>

      {scanning && <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}
