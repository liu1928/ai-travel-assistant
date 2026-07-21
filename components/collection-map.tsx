"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { SavedPlace, PlaceTag } from "@/schema/place";

// 色系對齊 app/page.tsx 既有 TAG_STYLE 的 Tailwind 色系（取 600 色階，供 Leaflet 用純色字串）。
export const TAG_COLOR: Record<PlaceTag, string> = {
  海景: "#0284c7",
  河岸: "#0891b2",
  山林: "#059669",
  咖啡: "#d97706",
  美食: "#ea580c",
  夜景: "#4f46e5",
  城市: "#475569",
  文化: "#e11d48",
  親子: "#65a30d",
  住宿: "#57534e",
};
const FALLBACK_COLOR = "#525252";

function FitBounds({ places }: { places: SavedPlace[] }) {
  const map = useMap();
  useEffect(() => {
    if (places.length === 0) return;
    if (places.length === 1) {
      map.setView([places[0].location.lat, places[0].location.lng], 14);
      return;
    }
    const bounds: [number, number][] = places.map((p) => [p.location.lat, p.location.lng]);
    map.fitBounds(bounds, { padding: [30, 30] });
    // 只在掛載時設定「初始視野」：即使目前呼叫端 places 參照穩定，這裡固定用空 deps 防禦，
    // 避免未來改動讓 places 變成每次 render 都重算的新陣列時，意外重置使用者手動平移的視野
    // （day-route-map.tsx 的 FitBounds 就踩過這個坑，見那邊註解）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function CollectionMap({ places }: { places: SavedPlace[] }) {
  if (places.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400">
        沒有可顯示的地點
      </div>
    );
  }

  return (
    <div className="h-96 overflow-hidden rounded-lg border border-neutral-200">
      <MapContainer
        center={[places[0].location.lat, places[0].location.lng]}
        zoom={12}
        scrollWheelZoom
        className="h-full w-full"
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds places={places} />
        {places.map((p) => (
          <CircleMarker
            key={p.placeId}
            center={[p.location.lat, p.location.lng]}
            radius={8}
            pathOptions={{
              color: TAG_COLOR[p.tags[0]] ?? FALLBACK_COLOR,
              fillColor: TAG_COLOR[p.tags[0]] ?? FALLBACK_COLOR,
              fillOpacity: 0.8,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{p.name}</p>
                {p.tags.length > 0 && <p className="text-xs text-neutral-500">{p.tags.join("、")}</p>}
                {p.address && <p className="text-xs text-neutral-500">{p.address}</p>}
                {p.note && <p className="mt-1 text-xs text-neutral-400">{p.note}</p>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
