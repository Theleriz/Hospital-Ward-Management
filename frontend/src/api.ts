// Thin wrapper over the backend API (same origin: /api is proxied by Vite or nginx)

export type Health = {
  status: "ok" | "error";
  database: "ok" | "unavailable";
};

export type Role = "Admissions" | "PublicStaff" | "Nurse" | "HeadNurse";

export type User = {
  account_id: string;
  full_name: string;
  role: Role;
};

export const ROLE_LABELS: Record<Role, string> = {
  Admissions: "Приёмное отделение",
  PublicStaff: "Персонал",
  Nurse: "Медсестра",
  HeadNurse: "Старшая медсестра",
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    if (response.status === 401) {
      // The session has expired: App goes back to the login screen
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(response.status, body?.detail));
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

export const UNAUTHORIZED_EVENT = "medbase:unauthorized";

const FIELD_LABELS: Record<string, string> = {
  full_name: "ФИО",
  dob: "дата рождения",
  phone: "телефон",
  gender: "пол",
  ward_id: "палата",
  badge_id: "бейдж",
  pin: "PIN",
};

// FastAPI puts the message in "detail": a string, or a list of invalid fields
function errorMessage(status: number, detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const fields = detail.map((d) => String(d?.loc?.at(-1) ?? "")).map((f) => FIELD_LABELS[f] ?? f);
    return `Проверьте поля: ${[...new Set(fields)].join(", ")}`;
  }
  return `Ошибка ${status}`;
}

export async function getHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  // 503 still carries a JSON body describing what is down
  if (!response.ok && response.status !== 503) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

export function login(badgeId: string, pin: string): Promise<User> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ badge_id: badgeId, pin }),
  });
}

export function logout(): Promise<void> {
  return request("/api/auth/logout", { method: "POST" });
}

/** Signed-in user, or null when there is no valid session */
export async function getCurrentUser(): Promise<User | null> {
  try {
    return await request<User>("/api/auth/me");
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

// --- Ward board (UC-4) ---------------------------------------------------------

export type Ward = {
  ward_id: number;
  ward_name: string;
  floor: number;
  ward_type: string;
  capacity: number;
  occupied: number;
  available: number;
};

export function getWards(): Promise<Ward[]> {
  return request("/api/wards");
}

// --- Admissions desk (UC-1 to UC-3) ------------------------------------------------

export type Gender = "Male" | "Female";

export type ActiveAdmission = {
  admission_id: number;
  patient_id: number;
  full_name: string;
  dob: string;
  phone: string | null;
  gender: Gender | null;
  ward_id: number;
  ward_name: string;
  admit_date: string;
};

export type NewAdmission = {
  full_name: string;
  dob: string;
  phone: string;
  gender: Gender | null;
  ward_id: number;
};

export function getActiveAdmissions(): Promise<ActiveAdmission[]> {
  return request("/api/admissions/active");
}

export function admitPatient(admission: NewAdmission): Promise<ActiveAdmission> {
  return request("/api/admissions", { method: "POST", body: JSON.stringify(admission) });
}

export function transferPatient(patientId: number, wardId: number): Promise<ActiveAdmission> {
  return request(`/api/admissions/${patientId}/transfer`, {
    method: "POST",
    body: JSON.stringify({ ward_id: wardId }),
  });
}

export function dischargePatient(patientId: number): Promise<void> {
  return request(`/api/admissions/${patientId}/discharge`, { method: "POST" });
}
