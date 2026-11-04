// Thin wrapper over the backend API (same origin: /api is proxied by Vite or nginx)

export type Health = {
  status: "ok" | "error";
  database: "ok" | "unavailable";
};

export async function getHealth(): Promise<Health> {
  const response = await fetch("/api/health");
  // 503 still carries a JSON body describing what is down
  if (!response.ok && response.status !== 503) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}
