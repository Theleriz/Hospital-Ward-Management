import { Button, Card, Chip } from "@heroui/react";
import { useCallback, useEffect, useState } from "react";

import { ApiError, getStaffReviews, markStaffReviewReviewed, type StaffReviewRequest } from "./api";
import { Initials, Notice } from "./ui";

const DATE_TIME = (iso: string) => new Date(iso).toLocaleString("ru-RU");

export default function StaffReviewPage() {
  const [items, setItems] = useState<StaffReviewRequest[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const reload = useCallback(
    () =>
      getStaffReviews()
        .then(setItems)
        .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить заявки")),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  async function mark(item: StaffReviewRequest) {
    setBusyId(item.request_id);
    setError("");
    try {
      await markStaffReviewReviewed(item.request_id);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Не удалось отметить проверку");
    } finally {
      setBusyId(null);
    }
  }

  const pending = items.filter((i) => i.status === "PENDING").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold text-[var(--text)]">Заявки на проверку</h2>
        <Chip variant="soft" color={pending ? "warning" : "success"}>
          {pending ? `ждут проверки: ${pending}` : "все проверены"}
        </Chip>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      {!items.length && (
        <Card>
          <Card.Content className="py-8 text-center text-[var(--muted)]">Заявок пока нет.</Card.Content>
        </Card>
      )}
      {items.map((item) => (
        <Card key={item.request_id}>
          <Card.Content className="flex flex-row flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Initials name={item.patient_name} size="lg" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 text-base font-semibold text-[var(--text)]">{item.patient_name}</h3>
                  <Chip size="sm" variant="soft" color={item.status === "PENDING" ? "warning" : "success"}>
                    {item.status === "PENDING" ? "ждёт проверки" : "проверено"}
                  </Chip>
                </div>
                <span className="text-xs text-[var(--muted)]">
                  Дата рождения: {item.patient_dob} · Заявка #{item.request_id}
                </span>
                <p className="m-0 text-sm text-[var(--text)]">{item.reason}</p>
                <span className="text-xs text-[var(--muted)]">
                  Отправил: {item.requested_by} · {DATE_TIME(item.created_at)}
                </span>
                {item.status !== "PENDING" && (
                  <span className="text-xs text-[var(--muted)]">
                    Проверил: {item.reviewed_by} · {item.reviewed_at && DATE_TIME(item.reviewed_at)}
                  </span>
                )}
              </div>
            </div>
            {item.status === "PENDING" && (
              <Button isDisabled={busyId !== null} onPress={() => void mark(item)}>
                {busyId === item.request_id ? "Сохранение…" : "Проверено"}
              </Button>
            )}
          </Card.Content>
        </Card>
      ))}
    </div>
  );
}
