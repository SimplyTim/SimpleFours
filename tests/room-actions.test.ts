import { describe, expect, it } from "vitest";
import { createDeck } from "@/lib/cards";
import {
  advanceRoom,
  advanceBots,
  applyRoomAction,
  createGuestPlayer,
  createHostPlayer,
  createRoomDoc,
  missingGameSeats,
  refreshRoomPresence,
  sanitizeRoomForPlayer,
  ttlFrom
} from "@/lib/room-actions";
import type { Card, GameState } from "@/types/game";

const now = "2026-06-19T00:00:00.000Z";
const later = "2026-06-19T00:10:00.000Z";
const afterCardHold = "2026-06-19T00:10:01.000Z";

function card(id: string): Card {
  const found = createDeck().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing card ${id}`);
  return found;
}

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

describe("room actions", () => {
  it("rejects non-host variant updates", () => {
    const room = readyRoom();
    expect(() => applyRoomAction(room, "p1", { type: "update-variants", variants: { kicking: "tobago" } }, later)).toThrow(
      "Only the host"
    );
  });

  it("rejects taking an occupied seat", () => {
    const room = createRoomDoc("ROOM123", createHostPlayer("host", "Host", "secret-host", now), now);
    room.players.push(createGuestPlayer("p1", "One", "secret-1", now));
    room.players[0].seat = 0;

    expect(() => applyRoomAction(room, "p1", { type: "choose-seat", seat: 0 }, later)).toThrow("already taken");
  });

  it("hides pre-play hands from players who are not dealer or dealer's right", () => {
    let room = readyRoom();
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);
    const game = room.game;
    expect(game).toBeTruthy();
    const cutter = room.players.find((player) => player.seat === game?.cutSeat);
    expect(cutter).toBeTruthy();
    room = applyRoomAction(room, cutter!.id, { type: "cut" }, later, () => 0);

    const hiddenPlayer = room.players.find(
      (player) => player.seat !== room.game?.dealerSeat && player.seat !== ((room.game!.dealerSeat + 1) % 4)
    );
    const dealer = room.players.find((player) => player.seat === room.game?.dealerSeat);

    expect(sanitizeRoomForPlayer(room, hiddenPlayer!.id).game.myHand).toHaveLength(0);
    expect(sanitizeRoomForPlayer(room, dealer!.id).game.myHand.length).toBeGreaterThan(0);
  });

  it("reveals teammate hands after begging resolves into play", () => {
    let room = readyRoom();
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);
    const cutter = room.players.find((player) => player.seat === room.game?.cutSeat)!;
    room = applyRoomAction(room, cutter.id, { type: "cut" }, later, () => 0);
    const beggar = room.players.find((player) => player.seat === ((room.game!.dealerSeat + 1) % 4))!;
    room = applyRoomAction(room, beggar.id, { type: "stand" }, later, () => 0);

    const view = sanitizeRoomForPlayer(room, beggar.id);
    expect(view.game.phase).toBe("playing");
    expect(view.game.teammateHand?.length).toBeGreaterThan(0);
  });

  it("refreshes room TTL after a valid action", () => {
    const room = readyRoom();
    const updated = applyRoomAction(room, "host", { type: "update-variants", variants: { kicking: "tobago" } }, later);
    expect(updated.expiresAt).toBe(ttlFrom(later));
  });

  it("lets the host add and remove bots in lobby seats", () => {
    let room = createRoomDoc("ROOM123", createHostPlayer("host", "Host", "secret-host", now), now);
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 1 }, later);

    const bot = room.players.find((player) => player.seat === 1);
    expect(bot?.isBot).toBe(true);
    expect(sanitizeRoomForPlayer(room, "host").seats[1].player?.isBot).toBe(true);

    room = applyRoomAction(room, "host", { type: "remove-bot", seat: 1 }, later);
    expect(room.players.some((player) => player.seat === 1)).toBe(false);
  });

  it("rejects guest bot management", () => {
    const room = readyRoom();
    expect(() => applyRoomAction(room, "p1", { type: "add-bot", seat: 1 }, later)).toThrow("Only the host");
  });

  it("advances bot turns until a human decision is reached", () => {
    let room = createRoomDoc("ROOM123", createHostPlayer("host", "Host", "secret-host", now), now);
    room = applyRoomAction(room, "host", { type: "choose-seat", seat: 0 }, later);
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 1 }, later);
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 2 }, later);
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 3 }, later);
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);
    room.game!.dealerSeat = 2;
    room.game!.cutSeat = 1;
    room.game!.turnSeat = 1;

    const advanced = advanceBots(room, later, () => 0);
    const activeSeat = advanced.game?.turnSeat;
    const activePlayer = advanced.players.find((player) => player.seat === activeSeat);

    expect(activePlayer?.isBot).not.toBe(true);
    expect(advanced.events.some((event) => event.message.includes("Bot chose"))).toBe(true);
  });

  it("pauses an active game when a player leaves and lets a replacement take the seat", () => {
    let room = readyRoom();
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);

    room = applyRoomAction(room, "p1", { type: "leave-seat" }, later);
    expect(room.players.find((player) => player.id === "p1")?.seat).toBeNull();
    expect(missingGameSeats(room)).toEqual([1]);
    expect(sanitizeRoomForPlayer(room, "host").seats[1].player).toBeNull();
    expect(() => applyRoomAction(room, "host", { type: "cut" }, later)).toThrow("paused");

    const replacement = createGuestPlayer("p4", "Replacement", "secret-4", later);
    room.players.push(replacement);
    room = applyRoomAction(room, "p4", { type: "choose-seat", seat: 1 }, later);

    expect(room.players.find((player) => player.id === "p4")?.seat).toBe(1);
    expect(missingGameSeats(room)).toEqual([]);
  });

  it("automatically restores a returning player to their abandoned seat when it is still open", () => {
    let room = readyRoom();
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);
    room.players.forEach((player) => {
      player.lastSeenAt = later;
    });
    room = applyRoomAction(room, "p1", { type: "leave-seat" }, later);

    room = refreshRoomPresence(room, "p1", afterCardHold);

    expect(room.players.find((player) => player.id === "p1")?.seat).toBe(1);
    expect(missingGameSeats(room)).toEqual([]);
    expect(room.events.some((event) => event.message.includes("rejoined Seat 2"))).toBe(true);
  });

  it("marks stale players as left and pauses bot automation", () => {
    let room = createRoomDoc("ROOM123", createHostPlayer("host", "Host", "secret-host", now), now);
    room = applyRoomAction(room, "host", { type: "choose-seat", seat: 0 }, later);
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 1 }, later);
    room.players.push(createGuestPlayer("p2", "Two", "secret-2", now));
    room.players.at(-1)!.seat = 2;
    room = applyRoomAction(room, "host", { type: "add-bot", seat: 3 }, later);
    room = applyRoomAction(room, "host", { type: "start-game" }, later, () => 0);
    room.game!.dealerSeat = 2;
    room.game!.cutSeat = 1;
    room.game!.turnSeat = 1;

    room = refreshRoomPresence(room, "host", later);
    const advanced = advanceBots(room, later, () => 0);

    expect(missingGameSeats(advanced)).toEqual([2]);
    expect(advanced.game?.turnSeat).toBe(1);
    expect(advanced.events.some((event) => event.message.includes("Two left Seat 3"))).toBe(true);
  });

  it("keeps cards clickable for the winner after the first lift settles", () => {
    let room = readyRoom();
    const game: GameState = {
      phase: "playing",
      handNumber: 1,
      dealerSeat: 0,
      cutSeat: 3,
      turnSeat: 3,
      scores: [0, 0],
      deck: [],
      hands: [[card("A-clubs")], [card("K-clubs")], [card("Q-clubs")], [card("4-hearts"), card("J-clubs")]],
      proposedTrump: "spades",
      trump: "spades",
      kickCards: [card("5-spades")],
      roundKickPoints: 0,
      currentTrick: [
        { seat: 0, card: card("K-hearts") },
        { seat: 1, card: card("2-hearts") },
        { seat: 2, card: card("3-hearts") }
      ],
      nextPlayAt: null,
      settlingTrick: null,
      completedTricks: [],
      captured: [[], []],
      dealtTrumps: [{ card: card("5-spades"), seat: 0 }],
      forcedLeadSuit: null,
      scoreLog: [],
      roundSummary: null,
      dealerSelection: [],
      winnerTeam: null
    };
    room.status = "playing";
    room.game = game;

    room = applyRoomAction(room, "p3", { type: "play-card", cardId: "4-hearts" }, later);
    expect(sanitizeRoomForPlayer(room, "host").legalCardIds).toEqual([]);

    room = advanceRoom(room, afterCardHold, () => 0);
    const hostView = sanitizeRoomForPlayer(room, "host");

    expect(hostView.game.turnSeat).toBe(0);
    expect(hostView.legalCardIds).toEqual(["A-clubs"]);
  });

  it("keeps the room on the round summary until the host closes it", () => {
    let room = readyRoom();
    const game: GameState = {
      phase: "playing",
      handNumber: 1,
      dealerSeat: 0,
      cutSeat: 3,
      turnSeat: 3,
      scores: [0, 0],
      deck: [],
      hands: [[], [], [], [card("4-hearts")]],
      proposedTrump: "spades",
      trump: "spades",
      kickCards: [card("5-spades")],
      roundKickPoints: 0,
      currentTrick: [
        { seat: 0, card: card("K-hearts") },
        { seat: 1, card: card("2-hearts") },
        { seat: 2, card: card("3-hearts") }
      ],
      nextPlayAt: null,
      settlingTrick: null,
      completedTricks: [],
      captured: [[], []],
      dealtTrumps: [{ card: card("5-spades"), seat: 0 }],
      forcedLeadSuit: null,
      scoreLog: [],
      roundSummary: null,
      dealerSelection: [],
      winnerTeam: null
    };
    room.status = "playing";
    room.game = game;

    room = applyRoomAction(room, "p3", { type: "play-card", cardId: "4-hearts" }, later);
    room = advanceRoom(room, afterCardHold, () => 0);
    expect(room.game?.phase).toBe("round-summary");

    room = advanceRoom(room, new Date(Date.parse(afterCardHold) + 60_000).toISOString(), () => 0);
    expect(room.game?.phase).toBe("round-summary");
    expect(sanitizeRoomForPlayer(room, "host").availableActions).toContainEqual({ type: "ack-round-summary", label: "OK" });
    expect(sanitizeRoomForPlayer(room, "p1").availableActions).toEqual([]);
    expect(() => applyRoomAction(room, "p1", { type: "ack-round-summary" }, later)).toThrow("Only the host");

    room = applyRoomAction(room, "host", { type: "ack-round-summary" }, later, () => 0);
    expect(room.game?.phase).toBe("awaiting-cut");
    expect(room.game?.handNumber).toBe(2);
  });
});
