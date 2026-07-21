"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { DayMapItem } from "@/lib/day-map";

const ROUTE_COLOR = "#0f766e";

// 序號 divIcon（不用 Leaflet 預設 PNG icon，避免 bundler 路徑問題）。
function numberedIcon(n: number) {
  return L.divIcon({
    html: `<div style="background:${ROUTE_COLOR};color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3)">${n}</div>`,
    className: "",
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [30, 30] });
    // 只在掛載時設定「初始視野」（spec 用詞）：points 是父層每次 render 都重新算出的新陣列參照
    // （resolveDayMapItems 沒有 memoize），若放進 deps 會讓使用者手動平移/縮放地圖後，
    // 因頁面其他無關 state 變動（例如編輯別天的備註）觸發重render 而被強制重置視野。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export default function DayRouteMap({ items }: { items: DayMapItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400">
        此日無座標可顯示
      </div>
    );
  }

  const points: [number, number][] = items.map((it) => [it.lat, it.lng]);

  return (
    <div className="h-72 overflow-hidden rounded-lg border border-neutral-200">
      <MapContainer center={points[0]} zoom={13} scrollWheelZoom className="h-full w-full">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <FitBounds points={points} />
        <Polyline positions={points} pathOptions={{ color: ROUTE_COLOR, weight: 3 }} />
        {items.map((it, i) => (
          <Marker key={i} position={[it.lat, it.lng]} icon={numberedIcon(i + 1)}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">
                  {it.time} {it.title}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
