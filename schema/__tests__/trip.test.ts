import { describe, it, expect } from "vitest";
import { tripSchema, flightSchema, carRentalSchema, lodgingSchema, tripWithBookingsSchema } from "../trip";

const validTrip = {
  title: "台中城市放鬆行",
  location: "台中",
  style: "relax",
  summary: "週末台中悠閒兩天一夜",
  days: [
    {
      day: 1,
      schedule: [
        { time: "09:00", title: "早餐", description: "在地咖啡廳吃早午餐", type: "food" },
        {
          time: "10:30",
          title: "美術館",
          description: "散步看展",
          type: "place",
          location: "國立台灣美術館",
        },
      ],
    },
  ],
  insights: ["行程節奏適中"],
  budget: { min: 2000, max: 5000 },
};

describe("tripSchema", () => {
  it("接受合法行程", () => {
    expect(tripSchema.safeParse(validTrip).success).toBe(true);
  });

  it("拒絕非法 time 格式", () => {
    const bad = {
      ...validTrip,
      days: [
        {
          day: 1,
          schedule: [{ ...validTrip.days[0].schedule[0], time: "9am" }],
        },
      ],
    };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕 budget.max 小於 min", () => {
    const bad = { ...validTrip, budget: { min: 5000, max: 1000 } };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕未知的 style", () => {
    const bad = { ...validTrip, style: "luxury" };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕空的 days", () => {
    const bad = { ...validTrip, days: [] };
    expect(tripSchema.safeParse(bad).success).toBe(false);
  });
});

const validFlight = {
  flightNo: "BR198",
  from: "台北 TPE",
  to: "沖繩 OKA",
  date: "2026-09-25",
  departTime: "10:00",
  arriveTime: "12:30",
};

const validRental = {
  company: "OTS",
  pickupLocation: "那霸機場",
  pickupTime: "13:30",
  dropoffLocation: "那霸機場",
  dropoffTime: "15:00",
};

describe("flightSchema", () => {
  it("接受合法航班（airline/date/note 可省略）", () => {
    expect(flightSchema.safeParse(validFlight).success).toBe(true);
    const minimal = { flightNo: "IT230", from: "台北", to: "福岡", departTime: "07:00", arriveTime: "10:15" };
    expect(flightSchema.safeParse(minimal).success).toBe(true);
  });

  it("拒絕非法時間格式（12 小時制）", () => {
    expect(flightSchema.safeParse({ ...validFlight, departTime: "2:30 PM" }).success).toBe(false);
  });

  it("拒絕非法日期格式", () => {
    expect(flightSchema.safeParse({ ...validFlight, date: "2026/09/25" }).success).toBe(false);
  });

  it("拒絕空航班號", () => {
    expect(flightSchema.safeParse({ ...validFlight, flightNo: "" }).success).toBe(false);
  });
});

describe("carRentalSchema", () => {
  it("接受合法租車", () => {
    expect(carRentalSchema.safeParse(validRental).success).toBe(true);
  });

  it("拒絕空取車地點", () => {
    expect(carRentalSchema.safeParse({ ...validRental, pickupLocation: "" }).success).toBe(false);
  });

  it("拒絕非法還車時間", () => {
    expect(carRentalSchema.safeParse({ ...validRental, dropoffTime: "25:00" }).success).toBe(false);
  });
});

const validLodging = {
  name: "那霸 ○○飯店",
  address: "沖縄県那覇市...",
  checkInDate: "2026-09-25",
  checkInTime: "15:00",
  checkOutDate: "2026-09-28",
  checkOutTime: "11:00",
};

describe("lodgingSchema", () => {
  it("接受合法住宿（address/日期/時間/note 皆可省略，只需 name）", () => {
    expect(lodgingSchema.safeParse(validLodging).success).toBe(true);
    expect(lodgingSchema.safeParse({ name: "民宿A" }).success).toBe(true);
  });

  it("拒絕空的住宿名稱", () => {
    expect(lodgingSchema.safeParse({ ...validLodging, name: "" }).success).toBe(false);
  });

  it("拒絕非法入住時間（12 小時制）", () => {
    expect(lodgingSchema.safeParse({ ...validLodging, checkInTime: "3:00 PM" }).success).toBe(false);
  });

  it("拒絕非法退房日期格式", () => {
    expect(lodgingSchema.safeParse({ ...validLodging, checkOutDate: "2026/09/28" }).success).toBe(false);
  });
});

describe("tripWithBookingsSchema", () => {
  it("舊文件缺 flights/carRentals/lodgings 欄位 → default 補空陣列（免資料遷移）", () => {
    const parsed = tripWithBookingsSchema.safeParse(validTrip);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.flights).toEqual([]);
      expect(parsed.data.carRentals).toEqual([]);
      expect(parsed.data.lodgings).toEqual([]);
    }
  });

  it("接受含航班、租車與住宿的完整行程", () => {
    const full = { ...validTrip, flights: [validFlight], carRentals: [validRental], lodgings: [validLodging] };
    const parsed = tripWithBookingsSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.flights).toHaveLength(1);
      expect(parsed.data.carRentals).toHaveLength(1);
      expect(parsed.data.lodgings).toHaveLength(1);
    }
  });

  it("航班陣列裡有一筆格式錯 → 整筆拒絕（不靜默丟掉）", () => {
    const bad = { ...validTrip, flights: [validFlight, { ...validFlight, departTime: "9am" }] };
    expect(tripWithBookingsSchema.safeParse(bad).success).toBe(false);
  });

  it("住宿陣列裡有一筆缺 name → 整筆拒絕", () => {
    const bad = { ...validTrip, lodgings: [validLodging, { ...validLodging, name: "" }] };
    expect(tripWithBookingsSchema.safeParse(bad).success).toBe(false);
  });

  it("tripSchema（AI 輸出用）沒有 flights/carRentals/lodgings 欄位——防止模型編造訂位資料", () => {
    expect("flights" in tripSchema.shape).toBe(false);
    expect("carRentals" in tripSchema.shape).toBe(false);
    expect("lodgings" in tripSchema.shape).toBe(false);
  });

  it("舊文件缺 weather/exchangeRate → weather default []、exchangeRate 省略（免遷移）", () => {
    const parsed = tripWithBookingsSchema.safeParse(validTrip);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.weather).toEqual([]);
      expect(parsed.data.exchangeRate).toBeUndefined();
    }
  });

  it("接受合法天氣快照與匯率", () => {
    const full = {
      ...validTrip,
      weather: [
        { date: "2026-09-25", maxTempC: 30, minTempC: 24, precipitationMm: 2.5, description: "晴天" },
      ],
      exchangeRate: { from: "TWD", to: "JPY", rate: 4.7 },
    };
    const parsed = tripWithBookingsSchema.safeParse(full);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.weather).toHaveLength(1);
      expect(parsed.data.exchangeRate?.to).toBe("JPY");
    }
  });

  it("拒絕負降雨量的天氣快照", () => {
    const bad = {
      ...validTrip,
      weather: [{ date: "2026-09-25", maxTempC: 30, minTempC: 24, precipitationMm: -1, description: "晴天" }],
    };
    expect(tripWithBookingsSchema.safeParse(bad).success).toBe(false);
  });

  it("拒絕非正匯率", () => {
    const bad = { ...validTrip, exchangeRate: { from: "TWD", to: "JPY", rate: 0 } };
    expect(tripWithBookingsSchema.safeParse(bad).success).toBe(false);
  });

  it("tripSchema（AI 輸出用）沒有 weather/exchangeRate 欄位——防止模型編造天氣/匯率", () => {
    expect("weather" in tripSchema.shape).toBe(false);
    expect("exchangeRate" in tripSchema.shape).toBe(false);
  });
});
