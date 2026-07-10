import { NextResponse } from "next/server";
import { ApiError, cleanName, cleanRoomToken, jsonError, readJson, resolveParams } from "@/lib/api-utils";
import { createGuestPlayer, markInactivePlayersLeft, missingGameSeats, sanitizeRoomForPlayer } from "@/lib/room-actions";
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
      const roomWithPresence = markInactivePlayersLeft(current, now);
      const occupiedSeats = new Set(roomWithPresence.players.flatMap((player) => (player.seat === null ? [] : [player.seat])));
      if (roomWithPresence.status === "playing" && missingGameSeats(roomWithPresence).length === 0) {
        throw new ApiError("This game is already full.", 409);
      }
      if (roomWithPresence.status !== "lobby" && roomWithPresence.status !== "playing") {
        throw new ApiError("This game has already started.", 409);
      }
      if (roomWithPresence.status === "lobby" && occupiedSeats.size >= 4) throw new ApiError("This room is full.", 409);

      roomWithPresence.players.push(guest);
      roomWithPresence.updatedAt = now;
      roomWithPresence.expiresAt = new Date(Date.parse(now) + 24 * 60 * 60 * 1000).toISOString();
      roomWithPresence.events.push({
        id: `${Date.parse(now)}-join-${playerId}`,
        type: "system",
        at: now,
        message: `${name} joined the room.`
      });
      return roomWithPresence;
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
