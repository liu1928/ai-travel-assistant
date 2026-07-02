import { z } from "zod";

// 實際 Takeout「已儲存的地點.json」格式（2024 版）
// 欄位全小寫底線，place name 在 location.name，CID 在 google_maps_url

export const takeoutFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]), // [lng, lat]
    }),
    properties: z
      .object({
        google_maps_url: z.string().optional(),
        location: z
          .object({
            name: z.string().min(1),
            address: z.string().optional(),
            country_code: z.string().optional(),
          })
          .optional(),
        Comment: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type TakeoutFeature = z.infer<typeof takeoutFeatureSchema>;

export const takeoutFileSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.unknown()),
});

export type TakeoutFile = z.infer<typeof takeoutFileSchema>;
