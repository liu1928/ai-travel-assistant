// ⚠️ 伺服器端專用：已儲存行程的 Firestore CRUD（per-user）
import { db } from "./firebase";
import { tripSchema, type Trip } from "@/schema/trip";
import { ok, err, type Result } from "./result";
import { z } from "zod";

export type TripError = { kind: "db_error"; message: string } | { kind: "not_found" };

export const savedTripSchema = z.object({
  ...tripSchema.shape,
  id: z.string(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
});
export type SavedTrip = Trip & { id: string; createdAt: number; updatedAt?: number };

function tripsCol(uid: string) {
  return db().collection("users").doc(uid).collection("trips");
}
function fail(e: unknown): Result<never, TripError> {
  return err({ kind: "db_error", message: e instanceof Error ? e.message : String(e) });
}

export async function saveTrip(uid: string, trip: Trip): Promise<Result<SavedTrip, TripError>> {
  try {
    const ref = tripsCol(uid).doc();
    const doc: SavedTrip = { ...trip, id: ref.id, createdAt: Date.now() };
    await ref.set(doc);
    return ok(doc);
  } catch (e) {
    return fail(e);
  }
}

export async function listTrips(uid: string): Promise<Result<SavedTrip[], TripError>> {
  try {
    const snap = await tripsCol(uid).orderBy("createdAt", "desc").get();
    const trips: SavedTrip[] = [];
    for (const d of snap.docs) {
      const parsed = savedTripSchema.safeParse(d.data());
      if (parsed.success) trips.push(parsed.data);
    }
    return ok(trips);
  } catch (e) {
    return fail(e);
  }
}

export async function getTrip(uid: string, id: string): Promise<Result<SavedTrip, TripError>> {
  try {
    const doc = await tripsCol(uid).doc(id).get();
    if (!doc.exists) return err({ kind: "not_found" });
    const parsed = savedTripSchema.safeParse(doc.data());
    if (!parsed.success) return err({ kind: "not_found" });
    return ok(parsed.data);
  } catch (e) {
    return fail(e);
  }
}

export async function updateTrip(
  uid: string,
  id: string,
  trip: Trip,
): Promise<Result<SavedTrip, TripError>> {
  try {
    const ref = tripsCol(uid).doc(id);
    const existing = await ref.get();
    if (!existing.exists) return err({ kind: "not_found" });

    const parsed = savedTripSchema.safeParse(existing.data());
    const createdAt = parsed.success ? parsed.data.createdAt : Date.now();

    const doc: SavedTrip = { ...trip, id, createdAt, updatedAt: Date.now() };
    await ref.set(doc);
    return ok(doc);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTrip(uid: string, id: string): Promise<Result<null, TripError>> {
  try {
    await tripsCol(uid).doc(id).delete();
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}
