import { NextResponse } from "next/server";
import { cleanName, jsonError, readJson } from "@/lib/api-utils";
import { createHostPlayer, createRoomDoc, sanitizeRoomForPlayer } from "@/lib/room-actions";
import { getRoomStore } from "@/lib/room-store";
import { makePlayerId, makePlayerSecret, makeRoomToken } from "@/lib/security";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await readJson(request)) as Record<string, unknown>;
    const name = cleanName(body.name ?? "Host");
    const store = getRoomStore();
    const now = new Date().toISOString();
    const playerId = makePlayerId();
    const playerSecret = makePlayerSecret();
    const host = createHostPlayer(playerId, name, playerSecret, now);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const roomToken = makeRoomToken();
      const room = createRoomDoc(roomToken, host, now);
      try {
        await store.createRoom(room);
        return NextResponse.json({
          roomToken,
          playerId,
          playerSecret,
          state: sanitizeRoomForPlayer(room, playerId)
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
      }
    }

    throw new Error("Could not create a unique room token.");
  } catch (error) {
    return jsonError(error);
  }
}
