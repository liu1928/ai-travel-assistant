# Atlas AI — Firebase 架構（Phase 1）

> firebase-architect skill 規範要把決策記進 Lore，但此環境未連 GetLore / Firebase MCP，故改記於此檔。本機若有 GetLore 再同步。

## Architecture

- 單一 Firebase 專案，Firestore（native mode），預設 database。
- 寫入全走伺服器端：Next.js API route 用 **Firebase Admin SDK**（service account）操作，client 不直接連 Firestore（與藏 Anthropic 金鑰同一原則）。
- 憑證：service account 三欄位放 `.env`（`FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`）。
- 時間戳用伺服器端 `Date.now()`（epoch ms）存純數字，避免 Firestore Timestamp 讀取轉換；單人 dev 夠用，未來要嚴謹再換 `serverTimestamp()`。

## Schema

- Collection `places`，文件 id = Google `place_id`（天然去重——同地點重存只覆蓋）。
- 欄位：`placeId, name, address?, location{lat,lng}, googleTypes[], rating?, tags[]（固定 10 類）, note, createdAt, updatedAt`。
- 唯一來源：`src/schema/place.ts`（Zod → 型別 + 驗證）。
- P2 加登入後遷移為 `users/{uid}/places/{placeId}`。

## Rules（Phase 1）

client 不直接存取，全鎖。部署前貼到 Firestore：

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

（Admin SDK 繞過 rules，照常運作。P2 加 auth 後再開放對應 user。）

## Indexes

- 列表 `orderBy createdAt desc` → 單欄位索引自動，無需手動建。
- 若日後加「按標籤篩選」：需 `tags (array-contains) + createdAt` 複合索引。

## Next Actions

- [ ] GCP 啟用 Places API (New) + 綁帳單 → 取得 `GOOGLE_MAPS_API_KEY`
- [ ] Firebase 建專案 + 開 Firestore + 下載 service account → 填 `.env.local`
- [ ] 部署前把上面的 Rules 貼進 Firestore
- [ ] 本機跑 `pnpm typecheck && pnpm test && pnpm lint` 綠勾

## Lore Update

未連 GetLore，略；本檔即為決策紀錄。
