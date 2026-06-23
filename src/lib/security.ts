import { createHash, randomBytes, timingSafeEqual } from "crypto";

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeRoomToken(length = 7): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
}

export function makePlayerId(): string {
  return randomBytes(12).toString("base64url");
}

export function makePlayerSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretsMatch(secret: string, secretHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(secretHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
