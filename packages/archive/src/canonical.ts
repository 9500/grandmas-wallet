import { utf8ToBin } from '@bitauth/libauth';

/**
 * One byte encoding for a JSON value, so that hashes and signatures over it
 * can be recomputed by anyone: object keys sorted, no insignificant space,
 * and no values JSON cannot carry.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const canonicalJson = (value: JsonValue): string => {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Only whole numbers can be encoded.');
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value !== 'object') throw new Error('This value cannot be encoded.');
  const fields = Object.keys(value)
    .sort()
    .map((key) => {
      const field = value[key];
      if (field === undefined) throw new Error(`Field "${key}" has no value.`);
      return `${JSON.stringify(key)}:${canonicalJson(field)}`;
    });
  return `{${fields.join(',')}}`;
};

export const canonicalBytes = (value: JsonValue): Uint8Array => utf8ToBin(canonicalJson(value));
