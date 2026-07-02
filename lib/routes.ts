// ⚠️ 伺服器端專用：Google Routes API 封裝
// 只算「相鄰兩點」的實際車程（n-1 段），不做 n×n matrix，控制成本。
// 超過上限自動跳過；呼叫方應視為 best-effort，失敗不應讓整個生成流程失敗。

import { ok, err, type Result } from "./result";

export type TravelMode = "DRIVE" | "WALK" | "TRANSIT";

export type RouteLeg = { durationMin: number; distanceKm: number };

export type RoutesError =
  | { kind: "missing_key" }
  | { kind: "too_many_points"; count: number };

const MAX_LEGS = 20;

export async function estimateLegs(
  points: { lat: number; lng: number }[],
  mode: TravelMode = "DRIVE",
): Promise<Result<RouteLeg[], RoutesError>> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return err({ kind: "missing_key" });
  if (points.length < 2) return ok([]);

  const legCount = points.length - 1;
  if (legCount > MAX_LEGS) return err({ kind: "too_many_points", count: legCount });

  const legs: RouteLeg[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const origin = points[i];
    const destination = points[i + 1];

    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
          destination: {
            location: { latLng: { latitude: destination.lat, longitude: destination.lng } },
          },
          travelMode: mode,
          ...(mode === "DRIVE" ? { routingPreference: "TRAFFIC_AWARE" } : {}),
        }),
      });

      if (!res.ok) {
        legs.push({ durationMin: 0, distanceKm: 0 });
        continue;
      }

      const data = (await res.json()) as {
        routes?: { duration?: string; distanceMeters?: number }[];
      };
      const route = data.routes?.[0];
      const seconds = route?.duration ? parseInt(route.duration.replace("s", ""), 10) : 0;
      const meters = route?.distanceMeters ?? 0;

      legs.push({
        durationMin: Math.round(seconds / 60),
        distanceKm: Math.round((meters / 1000) * 10) / 10,
      });
    } catch {
      legs.push({ durationMin: 0, distanceKm: 0 });
    }
  }

  return ok(legs);
}

// 用地點名稱解析座標（供沒有已知座標的 AI 建議景點使用，例如 V1 生成的新地點）
export async function resolveCoordinates(
  name: string,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.location",
      },
      body: JSON.stringify({ textQuery: name, languageCode: "zh-TW", maxResultCount: 1 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: { location?: { latitude?: number; longitude?: number } }[];
    };
    const loc = data.places?.[0]?.location;
    if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
      return null;
    }
    return { lat: loc.latitude, lng: loc.longitude };
  } catch {
    return null;
  }
}
