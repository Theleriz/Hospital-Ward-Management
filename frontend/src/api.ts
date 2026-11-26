// Thin wrapper over the backend API (same origin: /api is proxied by Vite or nginx)

export type Health = {
  status: "ok" | "error";
  database: "ok" | "unavailable";
};

export type Role = "Admissions" | "PublicStaff" | "Nurse" | "HeadNurse" | "Doctor";

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
  Doctor: "Врач",
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
  spo2: "SpO₂",
  heart_rate: "пульс",
  systolic: "систолическое давление",
  diastolic: "диастолическое давление",
  respiratory_rate: "частота дыхания",
  temperature: "температура",
  age_years: "возраст",
  pregnant: "беременность",
  consciousness: "сознание",
  supplemental_oxygen: "дополнительный кислород",
  measurement_confirmed: "достоверность измерений",
  scale2_confirmed: "подтверждение шкалы SpO₂ 2",
  spo2_scale: "шкала SpO₂",
  nurse_id: "медсестра",
  reason: "причина",
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

// --- Nurse workstation (UC-5 to UC-7) ------------------------------------------------

export type Priority = "LOW" | "HIGH" | "CRITICAL";
export type AlertSource = "MONITOR" | "CALL_BUTTON";
export type NurseStatus = "Available" | "Busy" | "OffShift";

export type Alert = {
  alert_id: string;
  ward_id: number;
  ward_name: string;
  patient_name: string | null;
  source: AlertSource;
  priority: Priority;
  description: string | null;
  status: "PENDING" | "ESCALATED" | "ACKNOWLEDGED";
  assigned_nurse_id: string | null;
  assigned_nurse_name: string | null;
  escalated_to_id: string | null;
  escalated_to_name: string | null;
  acknowledged_by_id: string | null;
  acknowledged_by_name: string | null;
  created_at: string;
  escalated_at: string | null;
  acknowledged_at: string | null;
  age_seconds: number;
  mine: boolean;
  can_acknowledge: boolean;
};

export type AlertBoard = { open: Alert[]; recent: Alert[] };

export type NurseInfo = {
  nurse_id: string;
  full_name: string;
  role: Role;
  status: NurseStatus;
  wards: { ward_id: number; ward_name: string; is_primary: boolean }[];
};

export function getAlerts(): Promise<AlertBoard> {
  return request("/api/alerts");
}

export function acknowledgeAlert(alertId: string): Promise<Alert> {
  return request(`/api/alerts/${alertId}/acknowledge`, { method: "POST" });
}

export function getMyNurse(): Promise<NurseInfo> {
  return request("/api/nurses/me");
}

export function setMyStatus(status: NurseStatus): Promise<NurseInfo> {
  return request("/api/nurses/me/status", { method: "PUT", body: JSON.stringify({ status }) });
}

// --- Device simulator (demo only) ------------------------------------------------------

export type SimulatorWard = {
  ward_id: number;
  ward_name: string;
  patients: { patient_id: number; full_name: string; age_days?: number | null }[];
  nurse_on_duty: string | null;
};

export type DeviceAlert = {
  ward_id: number;
  patient_id: number | null;
  source: AlertSource;
  priority: Priority;
  description: string | null;
};

export function getSimulatorWards(): Promise<SimulatorWard[]> {
  return request("/api/simulator/wards");
}

export function raiseAlert(alert: DeviceAlert): Promise<{ alert_id: string; assigned_nurse_id: string | null }> {
  return request("/api/simulator/alerts", { method: "POST", body: JSON.stringify(alert) });
}

export type StaffReviewRequest = {
  request_id: number; patient_id: number; patient_name: string; patient_dob: string; reason: string;
  requested_by: string; created_at: string; status: "PENDING" | "REVIEWED";
  reviewed_by: string | null; reviewed_at: string | null;
};

export function submitStaffReview(patientId: number, reason: string): Promise<StaffReviewRequest> {
  return request("/api/staff-reviews", { method: "POST", body: JSON.stringify({ patient_id: patientId, reason }) });
}
export function getStaffReviews(): Promise<StaffReviewRequest[]> { return request("/api/staff-reviews"); }
export function markStaffReviewReviewed(id: number): Promise<StaffReviewRequest> {
  return request(`/api/staff-reviews/${id}/reviewed`, { method: "POST" });
}

 // --- Emergency Priority Detection (Week 12, demo only) ------------------

export type VitalSigns = {
  spo2: number;
  heart_rate: number;
  systolic: number;
  diastolic: number;
  respiratory_rate: number;
  temperature: number;
  measurement_confirmed: boolean;
  patient_at_rest: boolean;
  acute_symptoms: boolean;
};

export type PriorityAssessment = {
  priority: Priority | null;
  status: "CLASSIFIED" | "REVIEW_REQUIRED";
  reason: string;
  measurements: {
    spo2: number;
    heart_rate: number;
    systolic: number;
    diastolic: number;
    respiratory_rate: number;
    temperature: number;
  };
};

export function assessVitals(vitals: VitalSigns): Promise<PriorityAssessment> {
  return request("/api/simulator/assess-vitals", {
    method: "POST",
    body: JSON.stringify(vitals),
  });
}


// --- Head nurse report (UC-8) ------------------------------------------------------------

export type AlertStatus = "PENDING" | "ESCALATED" | "ACKNOWLEDGED";

export type ReportSummary = {
  total: number;
  acknowledged: number;
  open: number;
  escalated: number;
  avg_response_seconds: number | null;
  median_response_seconds: number | null;
  max_response_seconds: number | null;
  within_target: number;
};

export type ReportPriorityRow = {
  priority: Priority;
  total: number;
  acknowledged: number;
  escalated: number;
  avg_response_seconds: number | null;
};

export type ReportNurseRow = {
  nurse_id: string;
  full_name: string;
  assigned: number;
  acknowledged: number;
  avg_response_seconds: number | null;
  escalated_away: number;
  received_escalations: number;
};

export type HistoryAlert = {
  alert_id: string;
  ward_id: number;
  ward_name: string;
  source: AlertSource;
  priority: Priority;
  description: string | null;
  status: AlertStatus;
  assigned_nurse_id: string | null;
  assigned_nurse_name: string | null;
  escalated_to_id: string | null;
  escalated_to_name: string | null;
  acknowledged_by_id: string | null;
  acknowledged_by_name: string | null;
  created_at: string;
  escalated_at: string | null;
  acknowledged_at: string | null;
  response_seconds: number | null;
  was_escalated: boolean;
};

export type AlertReport = {
  hours: number;
  since: string;
  generated_at: string;
  target_seconds: number;
  summary: ReportSummary;
  by_priority: ReportPriorityRow[];
  by_nurse: ReportNurseRow[];
  alerts: HistoryAlert[];
  alerts_truncated: boolean;
};

export type AlertJournalEvent = {
  event_id: number;
  event_type: "CREATED" | "ASSIGNED" | "ESCALATED" | "ACKNOWLEDGED";
  nurse_id: string | null;
  nurse_name: string | null;
  occurred_at: string;
};

export function getAlertReport(hours: number): Promise<AlertReport> {
  return request(`/api/reports/alerts?hours=${hours}`);
}

export function getAlertJournal(alertId: string): Promise<AlertJournalEvent[]> {
  return request(`/api/reports/alerts/${encodeURIComponent(alertId)}/events`);
}

// --- NEWS2 automatic simulator mode ------------------------------------------

export type News2Consciousness = "ALERT" | "NEW_CONFUSION" | "VOICE" | "PAIN" | "UNRESPONSIVE";

export type News2VitalSigns = VitalSigns & {
  mode: "NEWS2";
  age_years: number | null;
  pregnant: boolean | null;
  consciousness: News2Consciousness | null;
  supplemental_oxygen: boolean | null;
  spo2_scale: 1 | 2;
  scale2_confirmed: boolean;
};

export type News2Assessment = PriorityAssessment & {
  news2_score: number | null;
  component_scores: Record<string, number>;
  news2_risk: "LOW" | "LOW_MEDIUM" | "MEDIUM" | "HIGH" | null;
  single_parameter_trigger: boolean;
  classification_basis: "NEWS2" | "ACUTE_SYMPTOMS_OVERRIDE" | null;
  policy_version: string;
};

export function assessNews2Vitals(vitals: News2VitalSigns): Promise<News2Assessment> {
  return request("/api/simulator/assess-vitals", { method: "POST", body: JSON.stringify(vitals) });
}

export function raiseNews2Alert(input: {
  ward_id: number;
  patient_id: number | null;
  vitals: News2VitalSigns;
}): Promise<{ alert_id: string; assigned_nurse_id: string | null; assessment: News2Assessment }> {
  return request("/api/simulator/alerts/from-vitals", { method: "POST", body: JSON.stringify(input) });
}

// --- NHS England inpatient PEWS (educational only; never creates an alert) ---

export type PewsAssessment = {
  status: "CLASSIFIED" | "REVIEW_REQUIRED";
  score: number | null;
  component_scores: Record<string, number>;
  signals: string[];
  reason: string;
  chart_key: string | null;
  chart_name: string | null;
  source_url: string;
  risk_band?: "LOW" | "MEDIUM" | "HIGH" | "EMERGENCY" | null;
  policy_version: string;
};

export type PewsInput = {
  patient_id: number;
  respiratory_rate: number | null;
  respiratory_distress: "NONE" | "MILD" | "MODERATE" | "SEVERE" | null;
  spo2: number | null;
  oxygen_device: "AIR" | "OXYGEN" | "HIGH_FLOW" | "BIPAP" | "CPAP" | null;
  oxygen_delivery_pct: number | null;
  oxygen_delivery_lpm: number | null;
  oxygen_delivery_unit: "PERCENT" | "L_MIN" | null;
  heart_rate: number | null;
  systolic: number | null;
  systolic_code: "NCO" | "U0" | "U4" | null;
  crt_seconds: number | null;
  temperature: number | null;
  temperature_route: "AXILLA" | "TYMPANIC" | "SKIN" | null;
  avpu: "A" | "V" | "P" | "U" | null;
  sepsis_suspected: boolean | null;
  septic_shock_suspected: boolean | null;
  clinical_intuition: boolean | null;
  carer_response: "W" | "S" | "B" | "A" | "U" | null;
  risk_factors_confirmed: boolean | null;
  risk_factors: string[] | null;
  measurement_confirmed: boolean;
};

export function assessPews(input: PewsInput): Promise<PewsAssessment> {
  return request("/api/simulator/assess-pews", { method: "POST", body: JSON.stringify(input) });
}

// --- NHS England national maternity MEWS (educational only) -----------------

export type MaternalMewsInput = {
  patient_id: number;
  maternal_status: "PREGNANT" | "POSTPARTUM" | null;
  status_confirmed: boolean;
  delivery_at: string | null;
  respiratory_rate: number | null;
  spo2: number | null;
  temperature: number | null;
  heart_rate: number | null;
  systolic: number | null;
  diastolic: number | null;
  measurements_confirmed: boolean;
  additional_concerns_confirmed: boolean;
  additional_concerns: string[] | null;
};

export type MaternalMewsAssessment = {
  status: "CLASSIFIED" | "REVIEW_REQUIRED";
  score: number | null;
  component_scores: Record<string, number>;
  additional_concerns: string[];
  risk_level: "LOW" | "LOW_MEDIUM" | "MEDIUM" | "HIGH" | null;
  pulse_rule: "ANTENATAL" | "POSTPARTUM_UNDER_48H" | "POSTPARTUM_48H_PLUS" | null;
  reason: string;
  policy_version: string;
  source_url: string;
  scope_source_url: string;
};

export function assessMaternalMews(input: MaternalMewsInput): Promise<MaternalMewsAssessment> {
  return request("/api/simulator/assess-maternal-mews", {
    method: "POST", body: JSON.stringify(input),
  });
}

// --- Ward nurse assignments (head nurse, T-51) -----------------------------------------------

export type AssignedNurse = {
  nurse_id: string;
  full_name: string;
  status: NurseStatus;
  is_primary: boolean;
};

export type WardAssignment = {
  ward_id: number;
  ward_name: string;
  primary_nurse_id: string | null;
  nurses: AssignedNurse[];
};

export type NurseOption = {
  nurse_id: string;
  full_name: string;
  role: Role;
  status: NurseStatus;
};

export type AssignmentBoard = { wards: WardAssignment[]; nurses: NurseOption[] };

export type AssignmentAction = "ASSIGN_PRIMARY" | "ASSIGN_ADDITIONAL" | "REMOVE_ADDITIONAL" | "AUTO_ASSIGN_PRIMARY";

export type AssignmentLogEntry = {
  log_id: number;
  changed_at: string;
  ward_id: number;
  ward_name: string;
  action: AssignmentAction;
  nurse_id: string;
  nurse_name: string;
  previous_primary_nurse_id: string | null;
  changed_by_nurse_id: string | null;
  changed_by_name: string | null;
  reason: string | null;
};

export function getAssignments(): Promise<AssignmentBoard> {
  return request("/api/assignments");
}

export function setPrimaryNurse(wardId: number, nurseId: string, reason: string | null): Promise<WardAssignment> {
  return request(`/api/assignments/${wardId}/primary`, {
    method: "PUT",
    body: JSON.stringify({ nurse_id: nurseId, reason }),
  });
}

export function addWardNurse(wardId: number, nurseId: string, reason: string | null): Promise<WardAssignment> {
  return request(`/api/assignments/${wardId}/nurses`, {
    method: "POST",
    body: JSON.stringify({ nurse_id: nurseId, reason }),
  });
}

export function removeWardNurse(wardId: number, nurseId: string, reason: string | null): Promise<void> {
  const query = reason ? `?reason=${encodeURIComponent(reason)}` : "";
  return request(`/api/assignments/${wardId}/nurses/${encodeURIComponent(nurseId)}${query}`, { method: "DELETE" });
}

export function getAssignmentLog(wardId: number | null, limit = 50): Promise<AssignmentLogEntry[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (wardId !== null) params.set("ward_id", String(wardId));
  return request(`/api/assignments/log?${params}`);
}
