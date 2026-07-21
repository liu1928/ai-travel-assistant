import { z } from "zod";

export const tripStyle = z.enum(["relax", "food", "nature", "city"]);
export type TripStyle = z.infer<typeof tripStyle>;

export const scheduleItemType = z.enum(["transport", "food", "place", "rest"]);
export type ScheduleItemType = z.infer<typeof scheduleItemType>;

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

export const scheduleItemSchema = z.object({
  time: z.string().regex(timePattern, "time 必須是 HH:mm 格式"),
  title: z.string().min(1),
  description: z.string().min(1),
  type: scheduleItemType,
  location: z.string().optional(),
  // 預計佔用分鐘數（AI 生成帶出）；編輯本地重排的時長來源之一。optional：舊資料免遷移。
  // 上限一天（1440）：防 AI 生成離譜時長汙染重排計算（GLM REVIEW 2026-07-11 ⚠️-4）。
  durationMin: z.number().int().positive().max(1440).optional(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

export const tripDaySchema = z.object({
  day: z.number().int().positive(),
  schedule: z.array(scheduleItemSchema).min(1, "每天至少要有一個行程"),
});
export type TripDay = z.infer<typeof tripDaySchema>;

export const tripBudgetSchema = z
  .object({
    min: z.number().nonnegative(),
    max: z.number().nonnegative(),
  })
  .refine((b) => b.max >= b.min, { message: "budget.max 不可小於 min", path: ["max"] });
export type TripBudget = z.infer<typeof tripBudgetSchema>;

// day 編號必須從 1 開始連續（防 AI 只輸出「第 3 天」這種缺天結果；refinement 只在
// client-side 驗證，structured outputs 的 API 端 grammar 不含此約束）。抽成共用 helper，
// 因為 tripWithBookingsSchema 用 .extend() 覆寫 days 後會遺失原本掛在 tripSchema.days 上的 superRefine。
const consecutiveDaysArray = <T extends z.ZodTypeAny>(daySchema: T) =>
  z
    .array(daySchema)
    .min(1, "days 不可為空")
    .superRefine((days, ctx) => {
      const sorted = (days as { day: number }[]).map((d) => d.day).sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] !== i + 1) {
          ctx.addIssue({ code: "custom", message: "days 的 day 編號必須從 1 開始且連續" });
          break;
        }
      }
    });

export const tripSchema = z.object({
  title: z.string().min(1),
  location: z.string().min(1),
  style: tripStyle,
  summary: z.string().min(1),
  days: consecutiveDaysArray(tripDaySchema),
  insights: z.array(z.string()),
  budget: tripBudgetSchema,
});
export type Trip = z.infer<typeof tripSchema>;

// --- 航班與租車（使用者手動輸入的訂位資料）---
// ⚠️ tripSchema（AI 結構化輸出用）絕不能包含這些欄位，
// 否則 structured outputs 會讓模型編造航班號/時刻。見 specs/flights-rentals.md §3。

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const flightSchema = z.object({
  flightNo: z.string().min(1),
  airline: z.string().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
  date: z.string().regex(datePattern, "date 必須是 YYYY-MM-DD 格式").optional(),
  departTime: z.string().regex(timePattern, "departTime 必須是 HH:mm 格式"),
  arriveTime: z.string().regex(timePattern, "arriveTime 必須是 HH:mm 格式"),
  note: z.string().optional(),
});
export type Flight = z.infer<typeof flightSchema>;

export const carRentalSchema = z.object({
  company: z.string().optional(),
  pickupLocation: z.string().min(1),
  pickupDate: z.string().regex(datePattern, "pickupDate 必須是 YYYY-MM-DD 格式").optional(),
  pickupTime: z.string().regex(timePattern, "pickupTime 必須是 HH:mm 格式"),
  dropoffLocation: z.string().min(1),
  dropoffDate: z.string().regex(datePattern, "dropoffDate 必須是 YYYY-MM-DD 格式").optional(),
  dropoffTime: z.string().regex(timePattern, "dropoffTime 必須是 HH:mm 格式"),
  note: z.string().optional(),
});
export type CarRental = z.infer<typeof carRentalSchema>;

export const lodgingSchema = z.object({
  name: z.string().min(1),
  address: z.string().optional(),
  checkInDate: z.string().regex(datePattern, "checkInDate 必須是 YYYY-MM-DD 格式").optional(),
  checkInTime: z.string().regex(timePattern, "checkInTime 必須是 HH:mm 格式").optional(),
  checkOutDate: z.string().regex(datePattern, "checkOutDate 必須是 YYYY-MM-DD 格式").optional(),
  checkOutTime: z.string().regex(timePattern, "checkOutTime 必須是 HH:mm 格式").optional(),
  note: z.string().optional(),
});
export type Lodging = z.infer<typeof lodgingSchema>;

// --- 天氣與匯率（生成當下抓的加值快照，附掛在儲存行程上）---
// ⚠️ 同 flights：這些欄位絕不能進 tripSchema（AI structured output），否則模型會編造
// 天氣/匯率數字。只掛在 tripWithBookingsSchema，由 /api/trip/generate 生成後附掛。
// 形狀對齊 lib/weather.ts DailyWeather 與 lib/currency.ts ExchangeRate。

export const dailyWeatherSchema = z.object({
  date: z.string().regex(datePattern, "date 必須是 YYYY-MM-DD 格式"),
  maxTempC: z.number(),
  minTempC: z.number(),
  precipitationMm: z.number().nonnegative(),
  description: z.string().min(1),
});
export type DailyWeather = z.infer<typeof dailyWeatherSchema>;

export const exchangeRateSchema = z.object({
  from: z.string().min(1), // 來源貨幣，例 "TWD"
  to: z.string().min(1),   // 目標貨幣，例 "JPY"
  rate: z.number().positive(), // 1 from = rate to
});
export type ExchangeRate = z.infer<typeof exchangeRateSchema>;

// --- 行程項目錨定（server 生成時解析出的座標/placeId，用完即丟很浪費）---
// ⚠️ 同上：這些欄位絕不能進 scheduleItemSchema/tripSchema（AI structured output），
// 否則模型會編造 placeId/座標。全由 /api/trip/generate 生成後附掛，見 specs/schedule-anchoring.md。
export const savedScheduleItemSchema = scheduleItemSchema.extend({
  placeId: z.string().optional(), // 收藏對映成功才有（Google Place ID）
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  openingWarning: z.string().optional(), // specs/opening-hours.md 寫入，本檔只留欄位
});
export type SavedScheduleItem = z.infer<typeof savedScheduleItemSchema>;

export const savedTripDaySchema = tripDaySchema.extend({
  schedule: z.array(savedScheduleItemSchema).min(1, "每天至少要有一個行程"),
});
export type SavedTripDay = z.infer<typeof savedTripDaySchema>;

// 儲存/編輯用：Trip + 訂位資料 + 天氣/匯率快照 + 行程項目錨定。
// 舊 Firestore 文件缺欄位 → default 補空/略過，免資料遷移。
export const tripWithBookingsSchema = tripSchema.extend({
  days: consecutiveDaysArray(savedTripDaySchema),
  startDate: z.string().regex(datePattern, "startDate 必須是 YYYY-MM-DD 格式").optional(),
  flights: z.array(flightSchema).default([]),
  carRentals: z.array(carRentalSchema).default([]),
  lodgings: z.array(lodgingSchema).default([]),
  weather: z.array(dailyWeatherSchema).default([]),
  exchangeRate: exchangeRateSchema.optional(),
});
export type TripWithBookings = z.infer<typeof tripWithBookingsSchema>;
