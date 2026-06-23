import { describe, expect, it } from "vitest";
import { applyRoomAction, createGuestPlayer, createHostPlayer, createRoomDoc } from "@/lib/room-actions";
import {
  fromFirestoreRoom,
  fromRealtimeDatabaseRoom,
  toFirestoreRoom,
  toRealtimeDatabaseRoom
} from "@/lib/room-store";

const now = "2026-06-19T00:00:00.000Z";
const later = "2026-06-19T00:10:00.000Z";

function readyRoom() {
  const host = createHostPlayer("host", "Host", "secret-host", now);
  const room = createRoomDoc("ROOM123", host, now);
  room.players.push(
    createGuestPlayer("p1", "One", "secret-1", now),
    createGuestPlayer("p2", "Two", "secret-2", now),
    createGuestPlayer("p3", "Three", "secret-3", now)
  );
  room.players[0].seat = 0;
  room.players[1].seat = 1;
  room.players[2].seat = 2;
  room.players[3].seat = 3;
  return room;
}

describe("room store serialization", () => {
  it("stores game state as JSON to avoid Firestore nested array limits", () => {
    const room = applyRoomAction(readyRoom(), "host", { type: "start-game" }, later, () => 0);
    const firestoreRoom = toFirestoreRoom(room);

    expect(firestoreRoom).not.toHaveProperty("game");
    expect(typeof firestoreRoom.roomJson).toBe("string");

    const storedRoom = JSON.parse(firestoreRoom.roomJson as string);
    expect(storedRoom.game.hands).toHaveLength(4);
    expect(storedRoom.game.captured).toHaveLength(2);

    const roundTrip = fromFirestoreRoom(firestoreRoom);
    expect(roundTrip.game?.hands).toHaveLength(4);
    expect(roundTrip.game?.dealerSeat).toBe(room.game?.dealerSeat);
  });

  it("stores Realtime Database rooms with the same JSON payload shape", () => {
    const room = applyRoomAction(readyRoom(), "host", { type: "start-game" }, later, () => 0);
    const databaseRoom = toRealtimeDatabaseRoom(room);

    expect(databaseRoom).not.toHaveProperty("game");
    expect(typeof databaseRoom.roomJson).toBe("string");
    expect(databaseRoom.expiresAt).toBe(room.expiresAt);

    const roundTrip = fromRealtimeDatabaseRoom(databaseRoom);
    expect(roundTrip.game?.hands).toHaveLength(4);
    expect(roundTrip.game?.dealerSeat).toBe(room.game?.dealerSeat);
  });
});
