import { useCallback, useEffect, useState } from "react";
import { ApiError, getStaffReviews, markStaffReviewReviewed, type StaffReviewRequest } from "./api";

export default function StaffReviewPage() {
  const [items, setItems] = useState<StaffReviewRequest[]>([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const reload = useCallback(() => getStaffReviews().then(setItems)
    .catch((e) => setError(e instanceof ApiError ? e.message : "Не удалось загрузить заявки")), []);
  useEffect(() => { void reload(); }, [reload]);
  async function mark(item: StaffReviewRequest) {
    setBusyId(item.request_id); setError("");
    try { await markStaffReviewReviewed(item.request_id); await reload(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Не удалось отметить проверку"); }
    finally { setBusyId(null); }
  }
  return <section className="card stack">
    <h2>Заявки на проверку</h2>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {!items.length && <p className="hint">Заявок пока нет.</p>}
    {items.map((item) => <article className="card" key={item.request_id}>
      <h3>{item.patient_name}</h3>
      <p>Дата рождения: {item.patient_dob} · Заявка #{item.request_id}</p>
      <p>{item.reason}</p>
      <p className="hint">Отправил: {item.requested_by} · {new Date(item.created_at).toLocaleString("ru-RU")}</p>
      {item.status === "PENDING" ? <button disabled={busyId !== null} onClick={() => void mark(item)}>
        {busyId === item.request_id ? "Сохранение…" : "Проверено"}
      </button> : <p className="hint">Проверил: {item.reviewed_by} · {item.reviewed_at && new Date(item.reviewed_at).toLocaleString("ru-RU")}</p>}
    </article>)}
  </section>;
}
