import { NextResponse } from "next/server";
import { ApiError, cleanName, cleanRoomToken, jsonError, readJson, resolveParams } from "@/lib/api-utils";
import { createGuestPlayer, sanitizeRoomForPlayer } from "@/lib/room-actions";
import { getRoomStore } from "@/lib/room-store";
import { makePlayerId, makePlayerSecret } from "@/lib/security";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ roomToken: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { roomToken: rawRoomToken } = await resolveParams(context.params);
    const roomToken = cleanRoomToken(rawRoomToken);
    const body = (await readJson(request)) as Record<string, unknown>;
    const name = cleanName(body.name);
    const playerId = makePlayerId();
    const playerSecret = makePlayerSecret();
    const now = new Date().toISOString();
    const guest = createGuestPlayer(playerId, name, playerSecret, now);

    const room = await getRoomStore().updateRoom(roomToken, (current) => {
      if (current.status !== "lobby") throw new ApiError("This game has already started.", 409);
      if (current.players.length >= 4) throw new ApiError("This room is full.", 409);
      current.players.push(guest);
      current.updatedAt = now;
      current.expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
      current.events.push({
        id: `${Date.parse(now)}-join-${playerId}`,
        type: "system",
        at: now,
        message: `${name} joined the room.`
      });
      return current;
    });

    return NextResponse.json({
      roomToken,
      playerId,
      playerSecret,
      state: sanitizeRoomForPlayer(room, playerId)
    });
  } catch (error) {
    return jsonError(error);
  }
}
