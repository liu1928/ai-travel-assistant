# Spec — Map View（地圖視圖：收藏散點 + 每日路線）※ 規劃中，未實作

> 狀態：spec 已定稿待實作。實作時照本文件執行；有歧義回來改本文件。
> 前置：`specs/schedule-anchoring.md`（行程路線圖需要 item 座標；收藏散點圖無依賴，可先做）。

## 0. 為什麼是這份

旅遊 app 沒有地圖：收藏地點與行程路線目前只有文字。收藏的 `location.lat/lng` 資料齊全、行程座標由 schedule-anchoring 補上——畫出來即可，**零 API 成本**（Leaflet + OSM，不碰 Google Maps JS 的 $7/1K）。

## 1. 契約

### 1.1 選型與載入

- 套件：`leaflet@^1.9` + `react-leaflet@^5`（peer 支援 React 19）+ `@types/leaflet`（devDep）。用 pnpm 安裝。
- Tiles：`https://tile.openstreetmap.org/{z}/{x}/{y}.png`，**必附 attribution**（OSM 版權要求）；個人流量遠低於 OSMF tile 使用政策上限。
- SSR：兩個地圖元件一律 `next/dynamic(() => import(...), { ssr: false })` 載入（Leaflet 依賴 `window`）。
- CSS：`leaflet/dist/leaflet.css` 在元件內 import。
- Marker：用 `CircleMarker`（SVG）與 `L.divIcon`（HTML 序號），**不用 Leaflet 預設 PNG icon**（bundler 路徑問題的經典坑）。
- Bundle：dynamic import 自然切成獨立 chunk（Leaflet gzip 約 45KB），不開地圖不載。

### 1.2 新 `components/collection-map.tsx` — 收藏散點圖

- Props：`places: SavedPlace[]`（資料已在 `app/page.tsx` 的 state，零額外請求）。
- 每點 `CircleMarker`，顏色取地點第一個 tag：新增 `TAG_COLOR: Record<PlaceTag, string>`（hex 色表，色系對齊 `app/page.tsx` 既有 `TAG_STYLE`）。
- Popup：名稱 / tags / 地址 / 備註。
- 初始視野 `fitBounds` 涵蓋所有點；單點時 `setView` 固定 zoom。
- `app/page.tsx`：收藏區加「清單 / 地圖」切換（維持既有篩選狀態——切到地圖時只畫目前篩選結果）。

### 1.3 新 `components/day-route-map.tsx` — 單日路線圖

- Props：單日 schedule（含錨定座標）。
- 有座標的 stop 依順序畫 `divIcon` 序號 marker + `Polyline` 相連；popup 顯示 time/title。
- **座標優先序**：
  1. item 持久化 `lat/lng`（schedule-anchoring 之後生成的行程都有）；
  2. 舊行程降級：client 以 title/location 名稱對映收藏清單座標（打一次既有收藏 API，免費 Firestore 讀）；
  3. 都沒有 → 該點不上圖，地圖下方註「N 個項目無座標，未顯示」。
- **不做付費 geocode**——零成本是本功能硬約束。
- `app/trips/[id]/page.tsx`：每天卡片標題列加「地圖」toggle，展開該日路線圖。

## 2. 設計決策

- **Leaflet 而非 MapLibre**：只畫 marker/polyline，raster tiles 夠用且更輕；MapLibre 向量渲染是用不到的複雜度。
- **不碰 Google Maps JS**：Dynamic Maps $7/1K 且要多管一個 SKU；OSM 免費夠用。
- **transport/rest 類型的 stop**：無座標屬正常（「搭車移動」本來就不是點），缺席註記把它們排除在分母外（只數 place/food 類缺座標的）。
- **地圖是純呈現層**：不改任何資料寫入路徑，schema 零變更。

## 3. 影響檔案

| 檔案 | 變更 |
|---|---|
| `package.json` | 加 `leaflet`、`react-leaflet`、`@types/leaflet`（pnpm） |
| `components/collection-map.tsx`（新） | 收藏散點圖 |
| `components/day-route-map.tsx`（新） | 單日路線圖 |
| `app/page.tsx` | 清單/地圖切換 + `TAG_COLOR` 表 |
| `app/trips/[id]/page.tsx` | 每天「地圖」toggle |

## 4. 驗證基準

```bash
pnpm typecheck && pnpm test && pnpm lint && pnpm build
```

（本 spec 特別要求跑 `pnpm build`：SSR 相容性問題只在 build/runtime 現形。）

實測：
1. 收藏頁切「地圖」→ 散點顏色對應 tag、popup 內容正確、視野涵蓋全部點；篩選後只畫篩選結果。
2. 新生成行程開單日地圖 → 序號與時間軸一致、polyline 順序正確。
3. 舊行程（無持久化座標）→ 名稱對映可解析的點上圖，其餘顯示「N 個項目無座標」。
4. 不開地圖時 Network 無 leaflet chunk / OSM tile 請求。
5. 地圖角落有 OSM attribution。

## 5. 故障模式

| 症狀 | 原因 | 解法 |
|---|---|---|
| build 炸 `window is not defined` | 忘了 `ssr: false` 或在 server component import | 兩個元件只經 `next/dynamic` 進入 |
| marker 不顯示/破圖 | 用了 Leaflet 預設 PNG icon | 本 spec 明定 CircleMarker/divIcon |
| 地圖高度 0 | 容器未給明確高度 | 外層固定 h-64/h-96 等 Tailwind 高度 |
| tiles 不載 | attribution 缺失被擋或 URL 打錯 | 檢查 tile URL 與 attribution 設定 |

## 6. 已知限制

- 路線是直線 polyline，非實際道路路徑（Routes API polyline 另案，會增成本）。
- AI 自創地點在舊行程對映不到座標——隨新行程（地基落地後）自然消失。
