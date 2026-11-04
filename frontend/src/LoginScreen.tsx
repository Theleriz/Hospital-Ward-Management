import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { ApiError, login, type User } from "./api";

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
    <form className="card login" onSubmit={onSubmit}>
      <h2>Вход</h2>
      <p className="hint">Приложите бейдж к считывателю или введите его номер, затем PIN.</p>

      <label>
        Бейдж
        <input
          name="badge"
          value={badgeId}
          onChange={(e) => setBadgeId(e.target.value)}
          onKeyDown={onBadgeKeyDown}
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
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          autoComplete="off"
          maxLength={8}
          required
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Вход…" : "Войти"}
      </button>
    </form>
  );
}
