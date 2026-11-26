import JsBarcode from "jsbarcode";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { ApiError, getBadges, reissueBadge, ROLE_LABELS, type Badge, type Role } from "./api";
import { LogoMark } from "./icons";

type Notice = { kind: "ok" | "error"; text: string };

// Badge print page for the head nurse: name, role and a Code 128 barcode with the
// badge number. The barcode holds only the number; the PIN is never printed.
export default function BadgesPage() {
  const [badges, setBadges] = useState<Badge[] | null>(null);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  // Person whose badge alone goes to the printer; null prints every shown badge
  const [printOnly, setPrintOnly] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Badge | null>(null);
  const [saving, setSaving] = useState(false);

  async function reload() {
    try {
      setBadges(await getBadges());
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    const reset = () => setPrintOnly(null);
    window.addEventListener("afterprint", reset);
    return () => window.removeEventListener("afterprint", reset);
  }, []);

  function print(personId: string | null) {
    // Render the print selection before the print dialog takes its snapshot
    flushSync(() => setPrintOnly(personId));
    window.print();
  }

  async function reissue(badge: Badge) {
    setSaving(true);
    try {
      const fresh = await reissueBadge(badge.person_id);
      setNotice({
        kind: "ok",
        text: `${badge.full_name}: новый бейдж ${fresh.badge_id}. Старый ${badge.badge_id} больше не действует — распечатайте новый.`,
      });
      await reload();
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    } finally {
      setSaving(false);
      setConfirming(null);
    }
  }

  if (!badges) {
    return notice ? <p className="notice notice-error" role="alert">{notice.text}</p> : <div className="card" aria-busy="true" />;
  }

  const needle = query.trim().toLowerCase();
  const shown = badges.filter(
    (b) => !needle || `${b.full_name} ${b.badge_id} ${roleLabel(b.role)}`.toLowerCase().includes(needle),
  );

  return (
    <div className="stack">
      {notice && (
        <p className={`notice notice-${notice.kind} no-print`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}

      <section className="card no-print">
        <div className="section-head">
          <h2>Бейджи сотрудников</h2>
          <span className="badge badge-muted">{badges.length}</span>
        </div>
        <p className="hint">
          В штрих-код зашит только номер бейджа, PIN не печатается. Вход: сканировать бейдж, затем ввести PIN.
          Перевыпуск выдаёт новый номер, старый бейдж сразу перестаёт работать.
        </p>
        <div className="badges-toolbar">
          <label>
            Поиск
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Имя, роль или номер"
            />
          </label>
          <button type="button" onClick={() => print(null)} disabled={shown.length === 0}>
            Печать всех ({shown.length})
          </button>
        </div>
      </section>

      {shown.length === 0 ? (
        <p className="empty no-print">Никого не найдено</p>
      ) : (
        <div className="badges-grid">
          {shown.map((b) => (
            <article
              key={b.person_id}
              className="badge-item"
              data-print={printOnly === null || printOnly === b.person_id ? "yes" : "no"}
            >
              <div className="badge-card">
                <div className="badge-card-head">
                  <LogoMark size={22} />
                  <span>MedBase</span>
                </div>
                <strong className="badge-card-name">{b.full_name}</strong>
                <span className="badge-card-role">{roleLabel(b.role)}</span>
                <Barcode value={b.badge_id} />
              </div>
              <div className="badge-actions no-print">
                <button type="button" className="secondary" onClick={() => print(b.person_id)}>
                  Печать
                </button>
                <button type="button" className="secondary" onClick={() => setConfirming(b)}>
                  Перевыпустить
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {confirming && (
        <ReissueDialog
          badge={confirming}
          saving={saving}
          onConfirm={() => void reissue(confirming)}
          onClose={() => !saving && setConfirming(null)}
        />
      )}
    </div>
  );
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    JsBarcode(ref.current, value, {
      format: "CODE128",
      width: 2,
      height: 56,
      margin: 8,
      fontSize: 14,
      font: "monospace",
      // Black on white whatever the theme: scanners need the contrast
      background: "#ffffff",
      lineColor: "#000000",
    });
  }, [value]);

  return <svg ref={ref} className="badge-barcode" role="img" aria-label={`Штрих-код ${value}`} />;
}

function ReissueDialog({
  badge,
  saving,
  onConfirm,
  onClose,
}: {
  badge: Badge;
  saving: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  return (
    <dialog ref={ref} className="confirm-dialog" aria-labelledby="reissue-title" onClose={onClose}>
      <h1 id="reissue-title">Перевыпустить бейдж?</h1>
      <p>
        {badge.full_name} получит новый номер. Бейдж <strong>{badge.badge_id}</strong> сразу перестанет открывать
        вход. PIN не меняется.
      </p>
      <div className="dialog-actions">
        <form method="dialog">
          <button type="submit" className="secondary" autoFocus disabled={saving}>
            Отмена
          </button>
        </form>
        <button type="button" className="danger" onClick={onConfirm} disabled={saving}>
          {saving ? "Перевыпуск…" : "Перевыпустить"}
        </button>
      </div>
    </dialog>
  );
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен";
}
