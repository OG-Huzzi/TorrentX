import { createHash } from "node:crypto";

export function stableHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 16);
}
