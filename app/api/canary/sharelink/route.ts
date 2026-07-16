// 分享連結解析 canary：oioi8-kernel 每 5 分鐘 probe 此端點；內部以 24 小時
// 快取節流，實際的短連結展開＋Places API 呼叫每天最多一兩次（實例重啟會多
// 一次，可忽略）。Google 改 URL/頁面格式導致解析失敗時回 503 → kernel 連續
// 兩次失敗即 LINE 告警（seed：atlas-canary）——把「使用者踩雷才發現」變成
// 「當天早上主動通知」（2026-07-16 事故的防再犯機制，見 task/PLAN.md）。
import { NextResponse } from "next/server";
import { parseShareLink } from "@/lib/sharelink";

export const dynamic = "force-dynamic";

// 已知穩定存在店家的單一地點短連結（2026-07-16 實際事故案例，展開後為
// 新版無座標格式）。店家若倒閉/連結失效，換一條新的即可。
const CANARY_URL = "https://maps.app.goo.gl/X3zDsKifeHWBQC9s7";
const TTL_MS = 24 * 60 * 60 * 1000;

type CanaryState = {
  checkedAt: number;
  ok: boolean;
  detail: string;
};

let cache: CanaryState | null = null;
let inflight: Promise<CanaryState> | null = null;

async function runCheck(): Promise<CanaryState> {
  const r = await parseShareLink(CANARY_URL);
  if (r.ok && r.value.places.length > 0) {
    return {
      checkedAt: Date.now(),
      ok: true,
      detail: `resolved: ${r.value.places[0].name}`,
    };
  }
  // 詳細錯誤只進 server log；公開端點的回應僅給粗粒度原因，不外洩內部錯誤結構
  const reason = r.ok ? "no places returned" : JSON.stringify(r.error);
  console.error("[canary/sharelink] check failed:", reason);
  return { checkedAt: Date.now(), ok: false, detail: r.ok ? "no places returned" : "parse failed" };
}

export async function GET() {
  const now = Date.now();
  if (!cache || now - cache.checkedAt > TTL_MS) {
    // 併發請求共用同一次檢查，避免快取過期瞬間打出多次 Places API 呼叫
    if (!inflight) {
      inflight = runCheck().finally(() => {
        inflight = null;
      });
    }
    cache = await inflight;
  }
  const body = {
    canary: "sharelink",
    ok: cache.ok,
    checkedAt: new Date(cache.checkedAt).toISOString(),
    detail: cache.detail,
    hint: cache.ok
      ? undefined
      : "Google Maps 分享連結格式可能又變了——看 server log 的 [sharelink] finalUrl 診斷",
  };
  return NextResponse.json(body, { status: cache.ok ? 200 : 503 });
}
