# Atlas AI — 成本與額度速查

> 查證日期：2026-06。價格與額度會變動，實際以下方各官方頁面為準。

## 速查表

| 服務 | 用途（Phase） | 免費額度 | 超過後費率 | 備註 |
|---|---|---|---|---|
| Anthropic Claude API | AI 標籤（P1）、行程生成（P3） | 無永久免費（預付 $5 起，有試用 credit） | Sonnet 4.6 $3/$15、Haiku 4.5 $1/$5、Opus 4.8 $5/$25（每百萬 tokens，輸入/輸出） | batch 半價、cache 讀省 90%；標籤小任務用 Haiku 最划算 |
| Google Maps — Places API | 地點搜尋＋詳情（P1）、Takeout 補資料（P2） | 每 SKU 每月免費：Essentials 10K／Pro 5K／Enterprise 1K 次 | Place Details 約 $17/1K；Text Search 更貴；Place Photos 另計 | 通用 $200 月 credit 已於 2025/3 取消；需綁信用卡；用 field mask 省錢 |
| Google Maps — Routes API | 路線最佳化（P3） | 同上 per-SKU 免費額度 | Compute Routes 按次；Route Matrix 按 element（起點×終點）計，易爆量 | P3 才用到 |
| Google Maps — Maps JS（地圖顯示） | 前端畫地圖（如需要） | 約 28,500 次 Dynamic Maps 載入／月 | Dynamic Maps $7/1K、Geocoding $5/1K | 不需互動可改用 Static／Embed 省很多 |
| Firebase Firestore | 收藏資料庫（P1 起） | 每天 5 萬讀／2 萬寫／2 萬刪 ＋ 1 GB 儲存 ＋ 10 GB/月 流量 | 讀約 $0.06／10 萬次；寫／刪／儲存另計 | Spark 免費方案免綁卡；個人收藏幾乎不會超 |
| Firebase Auth | Google 登入（P2） | email／社群登入到 5 萬 MAU 免費 | 超過 5 萬才計；簡訊 OTP 另計付費 | 只用 Google 登入，免費範圍極大 |
| Firebase App Hosting | 部署／hosting（SSR） | 沿用 Cloud Run 免費額度（約 200 萬請求／月 + 360,000 GB-秒運算） | 超出後依 Cloud Run 計費 | **不再用 Vercel**：App Hosting 跑在 Google 環境，ADC 自動生效，繞過組織政策禁建 service account key 的限制 |

## 重點

- **Maps + Firebase 是同一個 GCP 帳號**，綁一張卡涵蓋兩邊。
- **最容易爆預算**：Places API（per-SKU）與 Routes（per-element）→ 在 GCP 後台設 budget alert。
- **最直接的成本槓桿**：標籤任務用 Haiku（$1/$5），行程生成用 Sonnet（$3/$15），靠 `.env` 的 `ANTHROPIC_MODEL` 切換。
- Phase 0 目前 **$0**，跑 `generateTrip` 真的打 API 才開始計，一次約幾分錢。
- **Wave 1 批次標籤**：`tagPlaces` 把多筆地點併入單次 Claude 呼叫，比逐筆呼叫省下大半 API 呼叫次數（呼叫數與成本砍一個量級）。

## 官方來源

- Anthropic 定價：https://platform.claude.com/docs/en/about-claude/pricing
- Google Maps Platform 定價：https://developers.google.com/maps/billing-and-pricing/pricing
- Firebase 定價：https://firebase.google.com/pricing
- Firestore 額度：https://firebase.google.com/docs/firestore/quotas
