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
    const body = await response.json().catch(() => null);
    // FastAPI puts the message in "detail" (a list for validation errors)
    const detail = typeof body?.detail === "string" ? body.detail : `Ошибка ${response.status}`;
    throw new ApiError(response.status, detail);
  }
  return response.status === 204 ? (undefined as T) : response.json();
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
