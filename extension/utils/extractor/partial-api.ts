import { z } from 'zod';

// 外部の項目は独立して読み取る。型の合わない値は欠落として返し、
// 応答全体の診断は呼び出し元の厳密なスキーマで行う。
export function partialFields<S extends Record<string, z.ZodType>>(shape: S) {
  const fields = Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.optional().catch(undefined)])) as { [K in keyof S]: z.ZodCatch<z.ZodOptional<S[K]>> };
  return z.looseObject(fields);
}

export function partialItems<T extends z.ZodType>(schema: T) {
  return z
    .array(schema.catch(undefined as never))
    .transform((items) => items.filter((item): item is z.output<T> => item !== undefined))
    .catch([]);
}
