import { Button, Card, Chip, Input, Label, TextField } from "@heroui/react";
import JsBarcode from "jsbarcode";
import { flushSync } from "react-dom";
import { useEffect, useRef, useState } from "react";

import { ApiError, getBadges, reissueBadge, ROLE_LABELS, type Badge, type Role } from "./api";
import { LogoMark } from "./icons";
import { ConfirmDialog, Notice as NoticeAlert, ScreenSkeleton } from "./ui";

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
    return notice ? (
      <NoticeAlert kind="error">{notice.text}</NoticeAlert>
    ) : (
      <ScreenSkeleton stats={0} cards={2} />
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = badges.filter(
    (b) => !needle || `${b.full_name} ${b.badge_id} ${roleLabel(b.role)}`.toLowerCase().includes(needle),
  );

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <div className="no-print">
          <NoticeAlert kind={notice.kind}>{notice.text}</NoticeAlert>
        </div>
      )}

      <Card className="no-print">
        <Card.Header className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <Card.Title render={(props) => <h2 {...props} />}>Бейджи сотрудников</Card.Title>
            <Card.Description>
              В штрих-код зашит только номер бейджа, PIN не печатается. Вход: сканировать бейдж, затем ввести PIN.
              Перевыпуск выдаёт новый номер, старый бейдж сразу перестаёт работать.
            </Card.Description>
          </div>
          <Chip variant="soft">{badges.length}</Chip>
        </Card.Header>
        <Card.Content className="flex flex-row flex-wrap items-end gap-3">
          <TextField type="search" value={query} onChange={setQuery} className="w-full max-w-sm">
            <Label>Поиск</Label>
            <Input placeholder="Имя, роль или номер" />
          </TextField>
          <Button onPress={() => print(null)} isDisabled={shown.length === 0}>
            Печать всех ({shown.length})
          </Button>
        </Card.Content>
      </Card>

      {shown.length === 0 ? (
        <p className="no-print m-0 py-6 text-center text-[var(--muted)]">Никого не найдено</p>
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
              <div className="no-print mt-2 flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onPress={() => print(b.person_id)}>
                  Печать
                </Button>
                <Button size="sm" variant="ghost" className="flex-1 text-[var(--down)]" onPress={() => setConfirming(b)}>
                  Перевыпустить
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Перевыпустить бейдж?"
        confirmLabel="Перевыпустить"
        busyLabel="Перевыпуск…"
        busy={saving}
        onConfirm={() => confirming && void reissue(confirming)}
      >
        {confirming && (
          <>
            {confirming.full_name} получит новый номер. Бейдж{" "}
            <strong className="text-[var(--text)]">{confirming.badge_id}</strong> сразу перестанет открывать вход. PIN не
            меняется.
          </>
        )}
      </ConfirmDialog>
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

function roleLabel(role: string): string {
  return ROLE_LABELS[role as Role] ?? role;
}

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен";
}
