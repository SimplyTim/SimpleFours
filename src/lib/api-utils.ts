import { NextResponse } from "next/server";
import { COMMON_CALLS, type CommonCall, type RoomAction, type RoomVariants, type Seat } from "@/types/game";

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

export function jsonError(error: unknown): NextResponse {
  const status = error instanceof ApiError ? error.status : error instanceof Error && error.message === "Room not found." ? 404 : 400;
  const message = error instanceof Error ? error.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status });
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError("Name is required.");
  const name = value.trim().replace(/\s+/g, " ").slice(0, 24);
  if (name.length < 1) throw new ApiError("Name is required.");
  return name;
}

export function cleanRoomToken(value: string): string {
  return value.trim().toUpperCase();
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function readCredentials(request: Request): { playerId: string; playerSecret: string } {
  const playerId = request.headers.get("x-player-id") ?? "";
  const playerSecret = request.headers.get("x-player-secret") ?? "";
  if (!playerId || !playerSecret) {
    throw new ApiError("Player credentials are required.", 401);
  }
  return { playerId, playerSecret };
}

export async function resolveParams<T extends Record<string, string>>(params: T | Promise<T>): Promise<T> {
  return params instanceof Promise ? params : Promise.resolve(params);
}

function asSeat(value: unknown): Seat {
  if (value === 0 || value === 1 || value === 2 || value === 3) return value;
  throw new ApiError("Seat must be between 1 and 4.");
}

function asCommonCall(value: unknown): CommonCall {
  if (typeof value === "string" && COMMON_CALLS.includes(value as CommonCall)) return value as CommonCall;
  throw new ApiError("Unknown call.");
}

export function parseRoomAction(value: unknown): RoomAction {
  if (!value || typeof value !== "object" || !("type" in value)) {
    throw new ApiError("Action type is required.");
  }

  const action = value as Record<string, unknown>;
  switch (action.type) {
    case "choose-seat":
      return { type: "choose-seat", seat: asSeat(action.seat) };
    case "add-bot":
      return { type: "add-bot", seat: asSeat(action.seat) };
    case "remove-bot":
      return { type: "remove-bot", seat: asSeat(action.seat) };
    case "update-variants":
      if (!action.variants || typeof action.variants !== "object") throw new ApiError("Variants are required.");
      return { type: "update-variants", variants: action.variants as Partial<RoomVariants> };
    case "start-game":
      return { type: "start-game" };
    case "cut":
      return typeof action.cutIndex === "number" ? { type: "cut", cutIndex: action.cutIndex } : { type: "cut" };
    case "stand":
      return { type: "stand" };
    case "beg":
      return { type: "beg" };
    case "take-one":
      return { type: "take-one" };
    case "run-cards":
      return { type: "run-cards" };
    case "deck-exhausted-choice":
      if (action.choice !== "pass-pack" && action.choice !== "forgo-points") throw new ApiError("Deck choice is required.");
      return { type: "deck-exhausted-choice", choice: action.choice };
    case "play-card":
      if (typeof action.cardId !== "string") throw new ApiError("Card id is required.");
      return { type: "play-card", cardId: action.cardId };
    case "emote":
      return { type: "emote", call: asCommonCall(action.call) };
    case "ack-round-summary":
      return { type: "ack-round-summary" };
    case "rematch":
      return { type: "rematch" };
    case "end-room":
      return { type: "end-room" };
    default:
      throw new ApiError("Unknown action.");
  }
}
