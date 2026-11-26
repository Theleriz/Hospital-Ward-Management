import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError, getLoginOptions, login, type User } from "./api";
import CameraScanner from "./CameraScanner";
import { BadgeIcon, ClockIcon, LogoMark, PostIcon, WardsIcon } from "./icons";

// Badge reader works like a keyboard: it types the badge ID and presses Enter.
// Enter in the badge field moves on to the PIN instead of submitting the form.
// Without a reader, the camera reads the barcode on the badge. The PIN is
// needed: a photo of a barcode must not be enough to log in. Only in the demo
// mode (MEDBASE_DEMO_BADGE_LOGIN on the server) the badge alone logs in at once.
export default function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [badgeId, setBadgeId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<{ message: string; locked: boolean } | null>(null);
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
        const invalidMessage = withPin === null
          ? "Неверный бейдж. Повторите попытку."
          : "Вы ввели логин или пароль неправильно. Повторите попытку.";
        setError(err instanceof ApiError
          ? { message: err.status === 401 ? invalidMessage : err.message, locked: err.status === 429 }
          : { message: "Сервер недоступен", locked: false });
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
    <div className="auth">
      <section className="auth-intro">
        <div className="brand brand-large">
          <LogoMark size={40} />
          <div>
            <strong>MedBase</strong>
            <span>Hospital Ward Management</span>
          </div>
        </div>
        <h1>Отделение под контролем: койки, вызовы и реакция персонала</h1>
        <ul className="auth-points">
          <li>
            <WardsIcon />
            <span>Занятость палат и движение пациентов в одном месте</span>
          </li>
          <li>
            <PostIcon />
            <span>Оповещения мониторов и кнопок вызова на посту за секунду</span>
          </li>
          <li>
            <ClockIcon />
            <span>Неподтверждённый срочный вызов через 30 секунд уходит свободной медсестре</span>
          </li>
        </ul>
        <p className="auth-foot">Team MedBase · внутренняя сеть отделения</p>
      </section>

      <section className="auth-panel">
        <form className="card login" onSubmit={onSubmit}>
          <span className="login-icon">
            <BadgeIcon size={24} />
          </span>
          <div>
            <h2>Вход по бейджу</h2>
            <p className="hint">Отсканируйте штрих-код бейджа сканером или камерой либо введите номер, затем PIN.</p>
          </div>

          <label>
            Бейдж
            <input
              ref={badgeRef}
              name="badge"
              value={badgeId}
              onChange={(e) => setBadgeId(e.target.value)}
              onKeyDown={onBadgeKeyDown}
              placeholder="BADGE-1001"
              autoFocus
              autoComplete="off"
              maxLength={32}
              required
            />
          </label>

          <button type="button" className="secondary button-block" onClick={() => setScanning(true)}>
            Сканировать камерой
          </button>

          {badgeOnly ? (
            <p className="notice notice-warn" role="status">
              Демо-режим: вход только по бейджу, без PIN. Не для реальной работы.
            </p>
          ) : (
          <label>
            PIN
            <input
              ref={pinRef}
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              title="4–8 цифр"
              placeholder="••••"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              autoComplete="off"
              maxLength={8}
              required
            />
          </label>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              {error.locked && <strong className="block">Вход временно заблокирован</strong>}
              {error.message}
            </div>
          )}

          <button type="submit" className="button-block" disabled={submitting}>
            {submitting ? "Вход…" : "Войти"}
          </button>
        </form>
      </section>

      {scanning && <CameraScanner onResult={onScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}
