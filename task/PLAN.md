# PLAN — Foundation Hardening E：記帳頁入口

> 任務來源：`specs/foundation-hardening.md` 項目 E（peanut：「再收尾E」）。
> 上一輪 PLAN（B/C/D）已 commit 於 `feat/foundation-bcd`（9284d553），git 歷史保留，本檔覆寫。
> 分支：`feat/foundation-e`（stacked on bcd）。純前端、無後端變動。

## 問題
`/trips/[id]/expenses` 記帳功能已上線，但全站**沒有任何 UI 入口**連到它（`grep '/expenses'` 在 trips 頁零命中）——使用者得手動改網址才進得去，等於功能被埋沒。

## 步驟（2 檔，純 UI）

### E-1 `app/trips/[id]/page.tsx`
- header 列（現有「← 返回行程列表」+ 條件式「去分帳 →」）右側改成 flex 容器，`view.status==="ready"` 時**永遠**顯示 `Link href={/trips/${view.trip.id}/expenses}`「💰 記帳」，「去分帳」維持條件式並列其後。

### E-2 `app/trips/page.tsx`
- 列表每筆行程的動作區（現有「刪除」按鈕）旁加 `Link href={/trips/${t.id}/expenses}`「💰 記帳」，站內導覽用 `next/link`。

## 設計
- 純站內 `next/link`，無後端、無資料模型變動、無新依賴。
- 沿用既有配色（teal 系）與 emoji 慣例。

## 驗收
```bash
pnpm typecheck && pnpm test && pnpm lint   # 全綠（test 不受影響）
```
實測：行程詳情頁與行程列表都看得到「💰 記帳」，點入即 `/trips/[id]/expenses`。
完成後：git diff → GLM review_code → REVIEW.md 仲裁 → REPORT.md → commit → push → PR → 停等 peanut。

## 不在本輪
- 逐筆計費、反向策展（見各 spec）。
