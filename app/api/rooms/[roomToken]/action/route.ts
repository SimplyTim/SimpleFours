import { NextResponse } from "next/server";
import {
  ApiError,
  cleanRoomToken,
  jsonError,
  parseRoomAction,
  readCredentials,
  readJson,
  resolveParams
} from "@/lib/api-utils";
import { advanceRoom, applyRoomAction, authenticateRoomPlayer, refreshRoomPresence, sanitizeRoomForPlayer } from "@/lib/room-actions";
import { getRoomStore } from "@/lib/room-store";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ roomToken: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<NextResponse> {
  try {
    const { roomToken: rawRoomToken } = await resolveParams(context.params);
    const roomToken = cleanRoomToken(rawRoomToken);
    const { playerId, playerSecret } = readCredentials(request);
    const body = await readJson(request);
    const action = parseRoomAction(body);
    const now = new Date().toISOString();

    const room = await getRoomStore().updateRoom(roomToken, (current) => {
      const player = authenticateRoomPlayer(current, playerId, playerSecret);
      if (!player) throw new ApiError("Invalid player credentials.", 401);
      const presentRoom = refreshRoomPresence(current, player.id, now);
      const readyRoom = advanceRoom(presentRoom, now);
      const actedRoom = applyRoomAction(readyRoom, player.id, action, now);
      return advanceRoom(actedRoom, now);
    });

    return NextResponse.json({ state: sanitizeRoomForPlayer(room, playerId) });
  } catch (error) {
    return jsonError(error);
  }
}
