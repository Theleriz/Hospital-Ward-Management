import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError, login, type User } from "./api";
import { BadgeIcon, ClockIcon, LogoMark, PostIcon, WardsIcon } from "./icons";

// Badge reader works like a keyboard: it types the badge ID and presses Enter.
// Enter in the badge field moves on to the PIN instead of submitting the form.
export default function LoginScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [badgeId, setBadgeId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  function onBadgeKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      pinRef.current?.focus();
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      onLogin(await login(badgeId.trim(), pin));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Сервер недоступен");
      setPin("");
      pinRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
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
            <p className="hint">Приложите бейдж к считывателю или введите его номер, затем PIN.</p>
          </div>

          <label>
            Бейдж
            <input
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

          {error && (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="button-block" disabled={submitting}>
            {submitting ? "Вход…" : "Войти"}
          </button>
        </form>
      </section>
    </div>
  );
}
