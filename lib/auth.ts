// ⚠️ 伺服器端專用：驗證 Firebase ID token
import { getAuth } from "firebase-admin/auth";
import { adminApp } from "./firebase";
import { ok, err, type Result } from "./result";

export type AuthError = { kind: "unauthenticated"; message: string };

export async function requireUid(req: Request): Promise<Result<string, AuthError>> {
  const header = req.headers.get("authorization") ?? "";
  const m = header.match(/^Bearer (.+)$/i);
  if (!m) return err({ kind: "unauthenticated", message: "未登入" });
  try {
    const decoded = await getAuth(adminApp()).verifyIdToken(m[1]);
    return ok(decoded.uid);
  } catch {
    return err({ kind: "unauthenticated", message: "登入憑證無效或已過期" });
  }
}
