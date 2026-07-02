// 統一的成功/失敗回傳型別，取代到處 throw。
// 用 discriminated union（string literal 'ok'）讓呼叫端用 if (r.ok) 收窄型別。

export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
