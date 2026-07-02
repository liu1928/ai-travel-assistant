// ⚠️ 伺服器端專用
import { initializeApp, getApps, applicationDefault, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export function adminApp(): App {
  const [existing] = getApps();
  if (existing) return existing;
  const projectId =
    process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || undefined;
  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

export function db(): Firestore {
  return getFirestore(adminApp());
}
