// ⚠️ 伺服器端專用：Firestore 收藏 CRUD（per-user）
import { db } from "./firebase";
import {
  savedPlaceSchema,
  type PlaceSearchResult,
  type PlaceTag,
  type SavedPlace,
  type BusinessStatus,
} from "@/schema/place";
import { ok, err, type Result } from "./result";

export type CollectionError = { kind: "db_error"; message: string };

function placesCol(uid: string) {
  return db().collection("users").doc(uid).collection("places");
}
function fail(e: unknown): Result<never, CollectionError> {
  return err({ kind: "db_error", message: e instanceof Error ? e.message : String(e) });
}

export async function addPlace(
  uid: string,
  place: PlaceSearchResult,
  tags: PlaceTag[],
): Promise<Result<SavedPlace, CollectionError>> {
  try {
    const now = Date.now();
    const doc: SavedPlace = { ...place, tags, note: "", createdAt: now, updatedAt: now };
    await placesCol(uid).doc(place.placeId).set(doc, { merge: true });
    return ok(doc);
  } catch (e) {
    return fail(e);
  }
}

export async function listPlaces(uid: string): Promise<Result<SavedPlace[], CollectionError>> {
  try {
    const snap = await placesCol(uid).orderBy("createdAt", "desc").get();
    const places: SavedPlace[] = [];
    for (const d of snap.docs) {
      const parsed = savedPlaceSchema.safeParse(d.data());
      if (parsed.success) places.push(parsed.data);
    }
    return ok(places);
  } catch (e) {
    return fail(e);
  }
}

export async function deletePlace(
  uid: string,
  placeId: string,
): Promise<Result<null, CollectionError>> {
  try {
    await placesCol(uid).doc(placeId).delete();
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function updateNote(
  uid: string,
  placeId: string,
  note: string,
): Promise<Result<null, CollectionError>> {
  try {
    await placesCol(uid).doc(placeId).update({ note, updatedAt: Date.now() });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function setGroup(
  uid: string,
  placeId: string,
  group: string | undefined,
): Promise<Result<null, CollectionError>> {
  try {
    // group 空字串或 undefined 視為「移除群組」
    const value = group && group.trim() !== "" ? group.trim() : null;
    if (value === null) {
      await placesCol(uid).doc(placeId).update({ group: null, updatedAt: Date.now() });
    } else {
      await placesCol(uid).doc(placeId).update({ group: value, updatedAt: Date.now() });
    }
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function updateTags(
  uid: string,
  placeId: string,
  tags: PlaceTag[],
): Promise<Result<null, CollectionError>> {
  try {
    await placesCol(uid).doc(placeId).update({ tags, updatedAt: Date.now() });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function updatePlaceStatus(
  uid: string,
  placeId: string,
  status: BusinessStatus,
  checkedAt: number,
): Promise<Result<null, CollectionError>> {
  try {
    await placesCol(uid).doc(placeId).update({ businessStatus: status, statusCheckedAt: checkedAt });
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}

export async function updateOpeningHours(
  uid: string,
  placeId: string,
  data: {
    openingHours?: Record<string, string | null>;
    checkedAt: number;
    businessStatus?: BusinessStatus;
  },
): Promise<Result<null, CollectionError>> {
  try {
    const update: Record<string, unknown> = { openingHoursCheckedAt: data.checkedAt };
    if (data.openingHours) update.openingHours = data.openingHours;
    if (data.businessStatus) {
      update.businessStatus = data.businessStatus;
      update.statusCheckedAt = data.checkedAt;
    }
    await placesCol(uid).doc(placeId).update(update);
    return ok(null);
  } catch (e) {
    return fail(e);
  }
}
