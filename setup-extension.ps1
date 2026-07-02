# Atlas AI Extension 一鍵安裝腳本
# 在 PowerShell 以系統管理員身份執行，或直接在 terminal 跑

$ExtDir = "D:\claude\atlas-extension"
$AtlasDir = "D:\claude\ai travel assistant"

Write-Host "建立 Extension 資料夾..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
New-Item -ItemType Directory -Force -Path "$AtlasDir\app\api\import\extension" | Out-Null

# ── manifest.json ──────────────────────────────────────────
Set-Content -Path "$ExtDir\manifest.json" -Encoding UTF8 -Value @'
{
  "manifest_version": 3,
  "name": "Atlas AI — Maps 匯入",
  "version": "1.0.0",
  "description": "把 Google Maps 收藏/清單一鍵匯入 Atlas AI",
  "permissions": ["activeTab", "scripting", "storage"],
  "host_permissions": ["https://www.google.com/maps/*"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "匯入到 Atlas"
  },
  "content_scripts": [
    {
      "matches": ["https://www.google.com/maps/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
  "options_ui": {
    "page": "options.html",
    "open_in_tab": false
  }
}
'@

# ── content.js ─────────────────────────────────────────────
Set-Content -Path "$ExtDir\content.js" -Encoding UTF8 -Value @'
// Atlas AI — content script
function extractPlaces() {
  const places = [];
  const seen = new Set();

  // Strategy 1: 抓帶 /maps/place/ 連結的元素
  const linkEls = document.querySelectorAll('a[href*="/maps/place/"]');
  for (const link of linkEls) {
    const href = link.href || "";
    const placeIdMatch = href.match(/\/place\/[^/]+\/(ChIJ[A-Za-z0-9_-]+)/);
    const placeId = placeIdMatch ? placeIdMatch[1] : null;
    const nameMatch = href.match(/\/maps\/place\/([^/]+)\//);
    const nameFromUrl = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, " ")) : null;
    const nameFromDom =
      link.getAttribute("aria-label") ||
      link.querySelector('[class*="fontHeadlineSmall"]')?.textContent?.trim() ||
      link.querySelector("h3")?.textContent?.trim() ||
      link.textContent?.trim().split("\n")[0].trim();
    const name = nameFromDom || nameFromUrl;
    if (!name || name.length < 2) continue;
    const key = placeId || name;
    if (seen.has(key)) continue;
    seen.add(key);
    const container = link.closest('[role="article"]') || link.parentElement;
    const addressEl = container?.querySelector('[class*="fontBodyMedium"] span');
    const address = addressEl?.textContent?.trim() || undefined;
    places.push({ name, placeId: placeId || undefined, address, sourceUrl: href });
  }

  // Strategy 2: role="article" fallback
  if (places.length === 0) {
    const articles = document.querySelectorAll('[role="article"]');
    for (const article of articles) {
      const name =
        article.getAttribute("aria-label") ||
        article.querySelector("h3")?.textContent?.trim() ||
        article.querySelector('[class*="fontHeadlineSmall"]')?.textContent?.trim();
      if (!name || name.length < 2) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const addressEl = article.querySelector('[class*="fontBodyMedium"] span');
      const address = addressEl?.textContent?.trim() || undefined;
      const link = article.querySelector('a[href*="/maps/place/"]');
      const href = link?.href || "";
      const placeIdMatch = href.match(/\/place\/[^/]+\/(ChIJ[A-Za-z0-9_-]+)/);
      places.push({ name, placeId: placeIdMatch?.[1] || undefined, address, sourceUrl: href || window.location.href });
    }
  }

  return places;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "extract") {
    sendResponse({ places: extractPlaces(), url: window.location.href });
  }
  return true;
});
'@

# ── popup.html ─────────────────────────────────────────────
Set-Content -Path "$ExtDir\popup.html" -Encoding UTF8 -Value @'
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <title>Atlas AI 匯入</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; width: 320px; min-height: 120px; background: #fff; color: #171717; }
    .header { padding: 14px 16px 10px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; justify-content: space-between; }
    .header h1 { font-size: 14px; font-weight: 600; }
    .settings-btn { background: none; border: none; cursor: pointer; color: #999; font-size: 16px; padding: 2px 4px; border-radius: 4px; }
    .settings-btn:hover { background: #f5f5f5; color: #555; }
    .body { padding: 14px 16px; }
    .hint { font-size: 12px; color: #888; margin-bottom: 12px; line-height: 1.5; }
    .place-list { max-height: 200px; overflow-y: auto; margin-bottom: 12px; border: 1px solid #eee; border-radius: 8px; }
    .place-item { padding: 8px 12px; font-size: 12px; border-bottom: 1px solid #f5f5f5; }
    .place-item:last-child { border-bottom: none; }
    .place-name { font-weight: 500; color: #222; }
    .place-addr { color: #999; margin-top: 1px; }
    .btn { width: 100%; padding: 9px; border-radius: 8px; border: none; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s; }
    .btn-primary { background: #0d7a5f; color: #fff; }
    .btn-primary:hover { background: #0b6b52; }
    .btn-primary:disabled { background: #b0c8c1; cursor: not-allowed; }
    .btn-secondary { background: #f5f5f5; color: #555; margin-top: 6px; }
    .btn-secondary:hover { background: #ececec; }
    .status { font-size: 12px; padding: 8px 10px; border-radius: 6px; margin-bottom: 10px; }
    .status.error { background: #fff1f0; color: #c0392b; }
    .status.success { background: #f0faf7; color: #0d7a5f; }
    .status.info { background: #f5f5f5; color: #555; }
    .empty { font-size: 12px; color: #aaa; text-align: center; padding: 20px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Atlas AI 匯入</h1>
    <button class="settings-btn" id="settingsBtn" title="設定">⚙</button>
  </div>
  <div class="body">
    <div id="status" class="status info" style="display:none"></div>
    <div id="hint" class="hint">請先在 Google Maps 開啟收藏清單，再點下方按鈕。</div>
    <div id="placeList" class="place-list" style="display:none"></div>
    <button class="btn btn-primary" id="extractBtn">讀取目前頁面地點</button>
    <button class="btn btn-primary" id="importBtn" style="display:none">匯入到 Atlas</button>
    <button class="btn btn-secondary" id="rescanBtn" style="display:none">重新讀取</button>
  </div>
  <script src="popup.js"></script>
</body>
</html>
'@

# ── popup.js ───────────────────────────────────────────────
Set-Content -Path "$ExtDir\popup.js" -Encoding UTF8 -Value @'
const DEFAULT_ATLAS_URL = "http://localhost:3000";
let extractedPlaces = [];
const $ = (id) => document.getElementById(id);

function showStatus(msg, type = "info") {
  const el = $("status");
  el.textContent = msg;
  el.className = `status ${type}`;
  el.style.display = "block";
}
function hideStatus() { $("status").style.display = "none"; }
function escHtml(str) { return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderPlaces(places) {
  const list = $("placeList");
  if (places.length === 0) {
    list.innerHTML = '<div class="empty">這個頁面找不到地點。<br>請切換到收藏/清單頁面。</div>';
    list.style.display = "block";
    $("importBtn").style.display = "none";
    return;
  }
  list.innerHTML = places.map(p => `
    <div class="place-item">
      <div class="place-name">${escHtml(p.name)}</div>
      ${p.address ? `<div class="place-addr">${escHtml(p.address)}</div>` : ""}
    </div>`).join("");
  list.style.display = "block";
  $("importBtn").style.display = "block";
  $("importBtn").textContent = `匯入 ${places.length} 個地點到 Atlas`;
}

async function extractFromPage() {
  $("extractBtn").disabled = true;
  $("hint").style.display = "none";
  showStatus("讀取中…", "info");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url?.includes("google.com/maps")) {
      showStatus("請先切換到 Google Maps 頁面", "error");
      $("extractBtn").disabled = false;
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    const response = await chrome.tabs.sendMessage(tab.id, { action: "extract" });
    extractedPlaces = response?.places ?? [];
    hideStatus();
    renderPlaces(extractedPlaces);
    $("rescanBtn").style.display = "block";
    if (extractedPlaces.length > 0) showStatus(`找到 ${extractedPlaces.length} 個地點`, "success");
  } catch (e) {
    showStatus(`讀取失敗：${e.message}`, "error");
  } finally {
    $("extractBtn").disabled = false;
  }
}

async function importToAtlas() {
  if (extractedPlaces.length === 0) return;
  $("importBtn").disabled = true;
  showStatus("匯入中，請稍候…", "info");
  try {
    const { atlasUrl } = await chrome.storage.sync.get({ atlasUrl: DEFAULT_ATLAS_URL });
    const res = await fetch(`${atlasUrl.replace(/\/$/, "")}/api/import/extension`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ places: extractedPlaces }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
    const { summary } = data;
    showStatus(`匯入完成！成功 ${summary.success}・跳過 ${summary.skipped}・失敗 ${summary.failed}`, "success");
    $("importBtn").style.display = "none";
  } catch (e) {
    showStatus(`匯入失敗：${e.message}`, "error");
  } finally {
    $("importBtn").disabled = false;
  }
}

$("extractBtn").addEventListener("click", () => void extractFromPage());
$("importBtn").addEventListener("click", () => void importToAtlas());
$("rescanBtn").addEventListener("click", () => {
  extractedPlaces = [];
  $("placeList").style.display = "none";
  $("importBtn").style.display = "none";
  $("rescanBtn").style.display = "none";
  hideStatus();
  $("hint").style.display = "block";
  void extractFromPage();
});
$("settingsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
'@

# ── options.html ───────────────────────────────────────────
Set-Content -Path "$ExtDir\options.html" -Encoding UTF8 -Value @'
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8" />
  <title>Atlas Extension 設定</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 32px; max-width: 480px; color: #171717; font-size: 14px; }
    h1 { font-size: 18px; font-weight: 600; margin-bottom: 24px; }
    label { display: block; font-weight: 500; margin-bottom: 6px; }
    input[type="text"] { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 13px; outline: none; }
    input[type="text"]:focus { border-color: #0d7a5f; box-shadow: 0 0 0 2px #0d7a5f22; }
    .hint { font-size: 12px; color: #888; margin-top: 6px; }
    .btn { margin-top: 20px; padding: 9px 20px; border-radius: 8px; border: none; background: #0d7a5f; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; }
    .btn:hover { background: #0b6b52; }
    .saved { margin-top: 12px; font-size: 12px; color: #0d7a5f; display: none; }
  </style>
</head>
<body>
  <h1>Atlas Extension 設定</h1>
  <label for="atlasUrl">Atlas AI 網址</label>
  <input type="text" id="atlasUrl" placeholder="http://localhost:3000" />
  <p class="hint">本機開發用 <code>http://localhost:3000</code>；部署後改為正式網址。</p>
  <button class="btn" id="saveBtn">儲存</button>
  <p class="saved" id="saved">✓ 已儲存</p>
  <script>
    const input = document.getElementById("atlasUrl");
    chrome.storage.sync.get({ atlasUrl: "http://localhost:3000" }, ({ atlasUrl }) => { input.value = atlasUrl; });
    document.getElementById("saveBtn").addEventListener("click", () => {
      chrome.storage.sync.set({ atlasUrl: input.value.trim().replace(/\/$/, "") }, () => {
        const s = document.getElementById("saved");
        s.style.display = "block";
        setTimeout(() => { s.style.display = "none"; }, 2000);
      });
    });
  </script>
</body>
</html>
'@

# ── Atlas API route ────────────────────────────────────────
Set-Content -Path "$AtlasDir\app\api\import\extension\route.ts" -Encoding UTF8 -Value @'
import { NextResponse, type NextRequest } from "next/server";
import { placeSearchResultSchema } from "@/schema/place";
import { tagPlace } from "@/lib/tagging";
import { addPlace, listPlaces } from "@/lib/collection";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { places?: unknown[] } | null;
  if (!Array.isArray(body?.places) || body.places.length === 0) {
    return NextResponse.json({ error: "places 陣列是空的或格式不對" }, { status: 400 });
  }
  const existingResult = await listPlaces();
  const existingIds = new Set(
    existingResult.ok ? existingResult.value.map((p) => p.placeId) : [],
  );
  const summary = { success: 0, skipped: 0, failed: 0 };
  for (const raw of body.places) {
    const r = raw as Record<string, unknown>;
    const parsed = placeSearchResultSchema.safeParse({
      placeId: r?.placeId ?? `ext-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: r?.name ?? "",
      address: r?.address,
      location: { lat: 0, lng: 0 },
      googleTypes: [],
    });
    if (!parsed.success || !parsed.data.name) { summary.failed++; continue; }
    if (existingIds.has(parsed.data.placeId)) { summary.skipped++; continue; }
    const tagged = await tagPlace(parsed.data);
    const tags = tagged.ok ? tagged.value : [];
    const saved = await addPlace(parsed.data, tags);
    if (saved.ok) { existingIds.add(parsed.data.placeId); summary.success++; }
    else { summary.failed++; }
  }
  return NextResponse.json({ summary });
}
'@

Write-Host ""
Write-Host "✅ 完成！" -ForegroundColor Green
Write-Host ""
Write-Host "Extension 位置：$ExtDir" -ForegroundColor Yellow
Write-Host "Atlas API 端點：$AtlasDir\app\api\import\extension\route.ts" -ForegroundColor Yellow
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "1. 開啟 Chrome → chrome://extensions"
Write-Host "2. 右上角開啟「開發者模式」"
Write-Host "3. 點「載入未封裝項目」→ 選 D:\claude\atlas-extension"
Write-Host "4. 確保 pnpm dev 在跑"
Write-Host "5. 開 Google Maps 收藏頁 → 點 Extension 圖示 → 讀取 → 匯入"
