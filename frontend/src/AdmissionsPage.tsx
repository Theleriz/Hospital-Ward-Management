import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  admitPatient,
  ApiError,
  dischargePatient,
  getActiveAdmissions,
  getWards,
  transferPatient,
  type ActiveAdmission,
  type Gender,
  type Ward,
} from "./api";
import WardBoard from "./WardBoard";

type Notice = { kind: "ok" | "error"; text: string } | null;

function messageOf(error: unknown): string {
  return error instanceof ApiError ? error.message : "Сервер недоступен";
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/** Admissions desk: admit, transfer, discharge (UC-1 to UC-3). */
export default function AdmissionsPage() {
  const [admissions, setAdmissions] = useState<ActiveAdmission[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  // Bumped after every change so the ward board reloads at once
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [active, wardList] = await Promise.all([getActiveAdmissions(), getWards()]);
      setAdmissions(active);
      setWards(wardList);
    } catch (error) {
      setNotice({ kind: "error", text: messageOf(error) });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, version]);

  const changed = (text: string) => {
    setNotice({ kind: "ok", text });
    setVersion((v) => v + 1);
  };
  const failed = (error: unknown) => setNotice({ kind: "error", text: messageOf(error) });

  return (
    <div className="stack">
      {notice && (
        <p className={`notice notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      )}
      <NewAdmissionForm wards={wards} onDone={changed} onError={failed} />
      <PatientsTable admissions={admissions} wards={wards} onDone={changed} onError={failed} />
      <WardBoard refreshKey={version} />
    </div>
  );
}

type ActionProps = {
  wards: Ward[];
  onDone: (text: string) => void;
  onError: (error: unknown) => void;
};

const EMPTY_FORM = { full_name: "", dob: "", phone: "", gender: "" as Gender | "", ward_id: "" };

function NewAdmissionForm({ wards, onDone, onError }: ActionProps) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const set = (field: keyof typeof EMPTY_FORM) => (value: string) => setForm((f) => ({ ...f, [field]: value }));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const admission = await admitPatient({
        full_name: form.full_name.trim(),
        dob: form.dob,
        phone: form.phone.replace(/[\s()-]/g, ""),
        gender: form.gender || null,
        ward_id: Number(form.ward_id),
      });
      onDone(`${admission.full_name} госпитализирован(а) в палату «${admission.ward_name}»`);
      setForm(EMPTY_FORM);
    } catch (error) {
      onError(error);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={onSubmit}>
      <h2 className="form-title">Новая госпитализация</h2>
      <p className="hint form-wide">
        Если пациент с таким телефоном уже был в больнице, используется его карточка.
      </p>
      <label className="form-wide">
        ФИО
        <input value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} required minLength={2} />
      </label>
      <label>
        Дата рождения
        <input type="date" value={form.dob} onChange={(e) => set("dob")(e.target.value)} required />
      </label>
      <label>
        Телефон
        <input
          type="tel"
          placeholder="+77015550000"
          value={form.phone}
          onChange={(e) => set("phone")(e.target.value)}
          required
        />
      </label>
      <label>
        Пол
        <select value={form.gender} onChange={(e) => set("gender")(e.target.value)}>
          <option value="">не указан</option>
          <option value="Female">женский</option>
          <option value="Male">мужской</option>
        </select>
      </label>
      <label>
        Палата
        <WardSelect wards={wards} value={form.ward_id} onChange={set("ward_id")} />
      </label>
      <div className="form-wide">
        <button type="submit" disabled={submitting}>
          {submitting ? "Сохранение…" : "Госпитализировать"}
        </button>
      </div>
    </form>
  );
}

function WardSelect({
  wards,
  value,
  onChange,
  exclude,
}: {
  wards: Ward[];
  value: string;
  onChange: (value: string) => void;
  exclude?: number;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required>
      <option value="" disabled>
        выберите палату
      </option>
      {wards
        .filter((w) => w.ward_id !== exclude)
        .map((w) => (
          <option key={w.ward_id} value={w.ward_id} disabled={w.available === 0}>
            {w.ward_name} — {w.available === 0 ? "мест нет" : `свободно ${w.available}`}
          </option>
        ))}
    </select>
  );
}

function PatientsTable({ admissions, ...actions }: ActionProps & { admissions: ActiveAdmission[] }) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const shown = query
    ? admissions.filter(
        (a) => a.full_name.toLowerCase().includes(query) || (a.phone ?? "").includes(query),
      )
    : admissions;

  return (
    <section className="card">
      <div className="section-head">
        <h2>Сейчас в отделении</h2>
        <span className="hint">{admissions.length} пациентов</span>
      </div>
      <input
        className="search"
        type="search"
        placeholder="Поиск по ФИО или телефону"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {shown.length === 0 ? (
        <p className="hint">{admissions.length ? "Никого не найдено" : "В отделении нет пациентов"}</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Пациент</th>
                <th>Телефон</th>
                <th>Палата</th>
                <th>Поступил(а)</th>
                <th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <PatientRow key={a.admission_id} admission={a} {...actions} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Mode = "view" | "transfer" | "discharge";

function PatientRow({ admission, wards, onDone, onError }: ActionProps & { admission: ActiveAdmission }) {
  const [mode, setMode] = useState<Mode>("view");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    try {
      onDone(await action());
      setMode("view");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }

  const transfer = () =>
    run(async () => {
      const moved = await transferPatient(admission.patient_id, Number(target));
      return `${admission.full_name} переведён(а) в палату «${moved.ward_name}»`;
    });

  const discharge = () =>
    run(async () => {
      await dischargePatient(admission.patient_id);
      return `${admission.full_name} выписан(а)`;
    });

  return (
    <tr>
      <td>
        <strong>{admission.full_name}</strong>
        <span className="hint block">р. {formatDate(admission.dob)}</span>
      </td>
      <td>{admission.phone ?? "—"}</td>
      <td>{admission.ward_name}</td>
      <td>{formatDate(admission.admit_date)}</td>
      <td className="actions">
        {mode === "view" && (
          <>
            <button type="button" className="secondary" onClick={() => setMode("transfer")}>
              Перевести
            </button>
            <button type="button" className="secondary" onClick={() => setMode("discharge")}>
              Выписать
            </button>
          </>
        )}
        {mode === "transfer" && (
          <>
            <WardSelect wards={wards} value={target} onChange={setTarget} exclude={admission.ward_id} />
            <button type="button" onClick={transfer} disabled={busy || !target}>
              Перевести
            </button>
            <button type="button" className="secondary" onClick={() => setMode("view")} disabled={busy}>
              Отмена
            </button>
          </>
        )}
        {mode === "discharge" && (
          <>
            <span>Выписать?</span>
            <button type="button" className="danger" onClick={discharge} disabled={busy}>
              Да, выписать
            </button>
            <button type="button" className="secondary" onClick={() => setMode("view")} disabled={busy}>
              Отмена
            </button>
          </>
        )}
      </td>
    </tr>
  );
}
