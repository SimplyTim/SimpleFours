import { NextResponse } from "next/server";
import { ApiError, cleanRoomToken, jsonError, readCredentials, resolveParams } from "@/lib/api-utils";
import { advanceRoom, authenticateRoomPlayer, refreshRoomPresence, roomNeedsAutomation, sanitizeRoomForPlayer } from "@/lib/room-actions";
import { getRoomStore } from "@/lib/room-store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ roomToken: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { roomToken: rawRoomToken } = await resolveParams(context.params);
    const roomToken = cleanRoomToken(rawRoomToken);
    const { playerId, playerSecret } = readCredentials(request);
    const store = getRoomStore();
    let room = await store.getRoom(roomToken);
    if (!room) throw new ApiError("Room not found.", 404);
    const player = authenticateRoomPlayer(room, playerId, playerSecret);
    if (!player) throw new ApiError("Invalid player credentials.", 401);
    const now = new Date().toISOString();
    room = await store.updateRoom(roomToken, (current) => {
      const currentPlayer = authenticateRoomPlayer(current, playerId, playerSecret);
      if (!currentPlayer) throw new ApiError("Invalid player credentials.", 401);
      const presentRoom = refreshRoomPresence(current, currentPlayer.id, now);
      return roomNeedsAutomation(presentRoom, now) ? advanceRoom(presentRoom, now) : presentRoom;
    });
    return NextResponse.json({ state: sanitizeRoomForPlayer(room, player.id) });
  } catch (error) {
    return jsonError(error);
  }
}
