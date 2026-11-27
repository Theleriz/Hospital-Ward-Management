import { Button, Card, Chip, Input, Label, ListBox, Select, TextField } from "@heroui/react";
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
import { SearchIcon } from "./icons";
import { ConfirmDialog, Initials, Notice } from "./ui";
import WardBoard from "./WardBoard";

type NoticeState = { kind: "ok" | "error"; text: string } | null;

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
  const [notice, setNotice] = useState<NoticeState>(null);
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
    <div className="flex flex-col gap-5">
      {notice && <Notice kind={notice.kind}>{notice.text}</Notice>}
      <NewAdmissionForm wards={wards} onDone={changed} onError={failed} />
      <PatientsTable admissions={admissions} wards={wards} onDone={changed} onError={failed} />
      <WardBoard refreshKey={version} compact />
    </div>
  );
}

type ActionProps = {
  wards: Ward[];
  onDone: (text: string) => void;
  onError: (error: unknown) => void;
};

const NO_GENDER = "none";
const EMPTY_FORM = { full_name: "", dob: "", phone: "", gender: NO_GENDER as Gender | typeof NO_GENDER, ward_id: "" };

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
        gender: form.gender === NO_GENDER ? null : form.gender,
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
    <Card>
      <Card.Header>
        <Card.Title render={(props) => <h2 {...props} />}>Новая госпитализация</Card.Title>
        <Card.Description>Если пациент с таким телефоном уже был в больнице, используется его карточка.</Card.Description>
      </Card.Header>
      <Card.Content>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" onSubmit={onSubmit}>
          <TextField
            className="md:col-span-2 xl:col-span-4"
            value={form.full_name}
            onChange={set("full_name")}
            isRequired
            minLength={2}
            fullWidth
          >
            <Label>ФИО</Label>
            <Input placeholder="Фамилия Имя Отчество" />
          </TextField>
          <TextField type="date" value={form.dob} onChange={set("dob")} isRequired fullWidth>
            <Label>Дата рождения</Label>
            <Input />
          </TextField>
          <TextField type="tel" value={form.phone} onChange={set("phone")} isRequired fullWidth>
            <Label>Телефон</Label>
            <Input placeholder="+77015550000" />
          </TextField>
          <Select
            selectedKey={form.gender}
            onSelectionChange={(key) => key !== null && set("gender")(String(key))}
            fullWidth
          >
            <Label>Пол</Label>
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id={NO_GENDER} textValue="не указан">
                  не указан
                </ListBox.Item>
                <ListBox.Item id="Female" textValue="женский">
                  женский
                </ListBox.Item>
                <ListBox.Item id="Male" textValue="мужской">
                  мужской
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <WardSelect label="Палата" wards={wards} value={form.ward_id} onChange={set("ward_id")} />
          <div className="md:col-span-2 xl:col-span-4">
            <Button type="submit" isDisabled={submitting || !form.ward_id}>
              {submitting ? "Сохранение…" : "Госпитализировать"}
            </Button>
          </div>
        </form>
      </Card.Content>
    </Card>
  );
}

function WardSelect({
  wards,
  value,
  onChange,
  exclude,
  label,
}: {
  wards: Ward[];
  value: string;
  onChange: (value: string) => void;
  exclude?: number;
  label?: string;
}) {
  const shown = wards.filter((w) => w.ward_id !== exclude);
  return (
    <Select
      aria-label={label ? undefined : "Палата для перевода"}
      placeholder="выберите палату"
      selectedKey={value || null}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      disabledKeys={shown.filter((w) => w.available === 0).map((w) => String(w.ward_id))}
      isRequired
      fullWidth
      className={label ? undefined : "min-w-56"}
    >
      {label && <Label>{label}</Label>}
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {shown.map((w) => (
            <ListBox.Item key={w.ward_id} id={String(w.ward_id)} textValue={w.ward_name}>
              <div className="flex w-full items-center justify-between gap-3">
                <span>{w.ward_name}</span>
                <span className={`text-xs ${w.available === 0 ? "text-[var(--down)]" : "text-[var(--ok)]"}`}>
                  {w.available === 0 ? "мест нет" : `свободно ${w.available}`}
                </span>
              </div>
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

const TH = "px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted)]";
const TD = "px-4 py-3 align-middle";

function PatientsTable({ admissions, ...actions }: ActionProps & { admissions: ActiveAdmission[] }) {
  const [filter, setFilter] = useState("");
  const query = filter.trim().toLowerCase();
  const shown = query
    ? admissions.filter((a) => a.full_name.toLowerCase().includes(query) || (a.phone ?? "").includes(query))
    : admissions;

  return (
    <Card>
      <Card.Header className="flex flex-row flex-wrap items-center justify-between gap-3">
        <Card.Title render={(props) => <h2 {...props} />}>Сейчас в отделении</Card.Title>
        <Chip variant="soft">{admissions.length} пациентов</Chip>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <TextField aria-label="Поиск пациента" value={filter} onChange={setFilter} className="max-w-md" fullWidth>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]">
              <SearchIcon size={18} />
            </span>
            <Input type="search" placeholder="Поиск по ФИО или телефону" className="w-full pl-10" />
          </div>
        </TextField>
        {shown.length === 0 ? (
          <p className="m-0 py-6 text-center text-[var(--muted)]">
            {admissions.length ? "Никого не найдено" : "В отделении нет пациентов"}
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-[var(--surface-2)]">
                <tr>
                  <th className={TH}>Пациент</th>
                  <th className={TH}>Телефон</th>
                  <th className={TH}>Палата</th>
                  <th className={TH}>Поступил(а)</th>
                  <th className={TH} aria-label="Действия" />
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
      </Card.Content>
    </Card>
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
    <tr className="border-t border-[var(--border)] hover:bg-[var(--surface-2)]">
      <td className={TD}>
        <div className="flex items-center gap-3">
          <Initials name={admission.full_name} />
          <div className="flex flex-col">
            <strong className="whitespace-nowrap text-[var(--text)]">{admission.full_name}</strong>
            <span className="text-xs text-[var(--muted)]">р. {formatDate(admission.dob)}</span>
          </div>
        </div>
      </td>
      <td className={`${TD} tabular-nums`}>{admission.phone ?? "—"}</td>
      <td className={TD}>
        <Chip size="sm" variant="soft" color="accent" className="whitespace-nowrap">
          {admission.ward_name}
        </Chip>
      </td>
      <td className={`${TD} tabular-nums`}>{formatDate(admission.admit_date)}</td>
      <td className={TD}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {(mode === "view" || mode === "discharge") && (
            <>
              <Button size="sm" variant="secondary" onPress={() => setMode("transfer")}>
                Перевести
              </Button>
              <Button size="sm" variant="ghost" className="text-[var(--down)]" onPress={() => setMode("discharge")}>
                Выписать
              </Button>
            </>
          )}
          {mode === "transfer" && (
            <>
              <WardSelect wards={wards} value={target} onChange={setTarget} exclude={admission.ward_id} />
              <Button size="sm" onPress={transfer} isDisabled={busy || !target}>
                Перевести
              </Button>
              <Button size="sm" variant="secondary" onPress={() => setMode("view")} isDisabled={busy}>
                Отмена
              </Button>
            </>
          )}
        </div>
        <ConfirmDialog
          isOpen={mode === "discharge"}
          onOpenChange={(open) => !open && setMode("view")}
          title="Выписать пациента?"
          confirmLabel="Да, выписать"
          busyLabel="Выписка…"
          busy={busy}
          onConfirm={discharge}
        >
          {admission.full_name} будет выписан(а) из палаты «{admission.ward_name}», место освободится сразу.
        </ConfirmDialog>
      </td>
    </tr>
  );
}
