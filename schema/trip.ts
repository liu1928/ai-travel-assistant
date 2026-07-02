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

export const tripSchema = z.object({
  title: z.string().min(1),
  location: z.string().min(1),
  style: tripStyle,
  summary: z.string().min(1),
  days: z.array(tripDaySchema).min(1, "days 不可為空"),
  insights: z.array(z.string()),
  budget: tripBudgetSchema,
});
export type Trip = z.infer<typeof tripSchema>;
