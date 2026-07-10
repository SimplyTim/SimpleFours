import { chooseBotAction, botForCurrentTurn } from "@/lib/bots";
import { cloneCards, gameCardValue, nextSeat, partnerSeat, seatTeam, sortCards } from "@/lib/cards";
import {
  beg,
  continueAfterRoundSummary,
  createInitialGame,
  cutAndDeal,
  legalCardsForSeat,
  playCard,
  resolveDeckExhaustion,
  runCards,
  settleTrickIfReady,
  stand,
  takeOne,
  visiblePartnerHand
} from "@/lib/rules";
import { hashSecret, makePlayerId, secretsMatch } from "@/lib/security";
import {
  COMMON_CALLS,
  type CommonCall,
  type PlayerRecord,
  type PublicAction,
  type PublicPlayer,
  type PublicSeat,
  type RoomAction,
  type RoomDoc,
  type RoomEvent,
  type RoomVariants,
  type SanitizedRoomState,
  type Seat
} from "@/types/game";

const DAY_MS = 24 * 60 * 60 * 1000;
const PLAYER_DISCONNECT_MS = 45_000;
const BOT_NAMES = ["Anansi", "Calypso", "Moko", "Soca"];
const TABLE_SEATS: Seat[] = [0, 1, 2, 3];

export function ttlFrom(now: string): string {
  return new Date(Date.parse(now) + DAY_MS).toISOString();
}

function cloneRoom(room: RoomDoc): RoomDoc {
  return structuredClone(room) as RoomDoc;
}

function makeEvent(now: string, event: Omit<RoomEvent, "id" | "at">): RoomEvent {
  return {
    ...event,
    id: `${Date.parse(now)}-${event.type}-${Math.random().toString(36).slice(2, 8)}`,
    at: now
  };
}

function pushEvent(room: RoomDoc, now: string, event: Omit<RoomEvent, "id" | "at">): void {
  room.events.push(makeEvent(now, event));
  if (room.events.length > 80) {
    room.events.splice(0, room.events.length - 80);
  }
}

function touch(room: RoomDoc, now: string): void {
  room.updatedAt = now;
  room.expiresAt = ttlFrom(now);
}

export function authenticateRoomPlayer(room: RoomDoc, playerId: string, playerSecret: string): PlayerRecord | null {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player || !secretsMatch(playerSecret, player.secretHash)) return null;
  return player;
}

export function createHostPlayer(playerId: string, name: string, secret: string, now: string): PlayerRecord {
  return {
    id: playerId,
    name,
    secretHash: hashSecret(secret),
    isHost: true,
    seat: null,
    joinedAt: now,
    lastSeenAt: now
  };
}

export function createGuestPlayer(playerId: string, name: string, secret: string, now: string): PlayerRecord {
  return {
    id: playerId,
    name,
    secretHash: hashSecret(secret),
    isHost: false,
    seat: null,
    joinedAt: now,
    lastSeenAt: now
  };
}

function createBotPlayer(name: string, seat: Seat, now: string): PlayerRecord {
  return {
    id: makePlayerId(),
    name,
    secretHash: "bot",
    isHost: false,
    isBot: true,
    seat,
    joinedAt: now,
    lastSeenAt: now
  };
}

export function createRoomDoc(roomToken: string, host: PlayerRecord, now: string): RoomDoc {
  return {
    roomToken,
    status: "lobby",
    hostPlayerId: host.id,
    players: [host],
    variants: {
      kicking: "trinidad",
      trumpLead: "anything"
    },
    game: null,
    events: [
      makeEvent(now, {
        type: "system",
        message: `${host.name} created the room.`
      })
    ],
    createdAt: now,
    updatedAt: now,
    expiresAt: ttlFrom(now)
  };
}

function requireHost(room: RoomDoc, player: PlayerRecord): void {
  if (!player.isHost || player.id !== room.hostPlayerId) {
    throw new Error("Only the host can do that.");
  }
}

function requireSeat(player: PlayerRecord): Seat {
  if (player.seat === null) {
    throw new Error("Choose a seat first.");
  }
  return player.seat;
}

function assertVariantUpdate(variants: Partial<RoomVariants>): Partial<RoomVariants> {
  const update: Partial<RoomVariants> = {};
  if (variants.kicking !== undefined) {
    if (variants.kicking !== "trinidad" && variants.kicking !== "tobago") {
      throw new Error("Unknown kicking variant.");
    }
    update.kicking = variants.kicking;
  }
  if (variants.trumpLead !== undefined) {
    if (variants.trumpLead !== "follow-suit" && variants.trumpLead !== "anything") {
      throw new Error("Unknown trump lead variant.");
    }
    update.trumpLead = variants.trumpLead;
  }
  return update;
}

function assertCommonCall(call: CommonCall): void {
  if (!COMMON_CALLS.includes(call)) {
    throw new Error("Unknown call.");
  }
}

function isSeat(seat: Seat | null): seat is Seat {
  return seat !== null;
}

function seatsAreReady(room: RoomDoc): boolean {
  const occupied = new Set(room.players.map((player) => player.seat).filter(isSeat));
  return occupied.size === 4;
}

function occupiedSeats(room: RoomDoc): Set<Seat> {
  return new Set(room.players.map((player) => player.seat).filter(isSeat));
}

function seatOccupant(room: RoomDoc, seat: Seat): PlayerRecord | undefined {
  return room.players.find((candidate) => candidate.seat === seat);
}

export function missingGameSeats(room: RoomDoc): Seat[] {
  if (room.status !== "playing" || !room.game || room.game.phase === "game-over") return [];
  const occupied = occupiedSeats(room);
  return TABLE_SEATS.filter((seat) => !occupied.has(seat));
}

function gameHasMissingSeats(room: RoomDoc): boolean {
  return missingGameSeats(room).length > 0;
}

function pushPlayerLeftEvent(room: RoomDoc, now: string, player: PlayerRecord, seat: Seat): void {
  pushEvent(room, now, {
    type: "system",
    seat,
    message: `${player.name} left Seat ${seat + 1}. Waiting for someone to take the seat.`
  });
}

function maybeTransferHost(room: RoomDoc, player: PlayerRecord, now: string): void {
  if (player.isHost) return;
  const seatedHost = room.players.find((candidate) => candidate.isHost && candidate.seat !== null);
  if (seatedHost) return;

  const oldHost = room.players.find((candidate) => candidate.id === room.hostPlayerId);
  if (oldHost) oldHost.isHost = false;
  player.isHost = true;
  room.hostPlayerId = player.id;
  pushEvent(room, now, {
    type: "system",
    seat: player.seat ?? undefined,
    message: `${player.name} is now the host.`
  });
}

function restoreReturningPlayer(room: RoomDoc, player: PlayerRecord, now: string): boolean {
  if (room.status !== "playing" || player.seat !== null || player.leftSeat === null || player.leftSeat === undefined) return false;
  if (seatOccupant(room, player.leftSeat)) return false;

  player.seat = player.leftSeat;
  player.leftSeat = null;
  maybeTransferHost(room, player, now);
  pushEvent(room, now, {
    type: "system",
    seat: player.seat,
    message: `${player.name} rejoined Seat ${player.seat + 1}.`
  });
  return true;
}

export function refreshRoomPresence(sourceRoom: RoomDoc, playerId: string, now: string): RoomDoc {
  const room = cloneRoom(sourceRoom);
  const currentPlayer = room.players.find((candidate) => candidate.id === playerId);
  if (!currentPlayer) throw new Error("Player is not in this room.");

  currentPlayer.lastSeenAt = now;
  restoreReturningPlayer(room, currentPlayer, now);

  if (room.status === "playing") {
    for (const player of room.players) {
      if (player.id === currentPlayer.id || player.isBot || player.seat === null) continue;
      if (Date.parse(now) - Date.parse(player.lastSeenAt) <= PLAYER_DISCONNECT_MS) continue;

      const seat = player.seat;
      player.seat = null;
      player.leftSeat = seat;
      pushPlayerLeftEvent(room, now, player, seat);
    }
  }

  touch(room, now);
  return room;
}

export function markInactivePlayersLeft(sourceRoom: RoomDoc, now: string): RoomDoc {
  const room = cloneRoom(sourceRoom);
  if (room.status !== "playing") return room;

  let changed = false;
  for (const player of room.players) {
    if (player.isBot || player.seat === null) continue;
    if (Date.parse(now) - Date.parse(player.lastSeenAt) <= PLAYER_DISCONNECT_MS) continue;

    const seat = player.seat;
    player.seat = null;
    player.leftSeat = seat;
    pushPlayerLeftEvent(room, now, player, seat);
    changed = true;
  }

  if (changed) touch(room, now);
  return room;
}

function canSeeOwnHand(game: NonNullable<RoomDoc["game"]>, seat: Seat): boolean {
  if (game.phase === "begging" || game.phase === "dealer-decision" || game.phase === "running" || game.phase === "deck-exhausted") {
    return seat === game.dealerSeat || seat === nextSeat(game.dealerSeat);
  }
  return game.phase === "playing" || game.phase === "game-over";
}

function publicPlayers(room: RoomDoc): PublicPlayer[] {
  return room.players.map((player) => ({
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    isBot: Boolean(player.isBot),
    seat: player.seat
  }));
}

export function applyRoomAction(
  sourceRoom: RoomDoc,
  playerId: string,
  action: RoomAction,
  now: string,
  random = Math.random
): RoomDoc {
  const room = cloneRoom(sourceRoom);
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Player is not in this room.");
  player.lastSeenAt = now;

  if (room.status === "ended" && action.type !== "rematch") {
    throw new Error("This room has ended.");
  }

  if (gameHasMissingSeats(room) && action.type !== "choose-seat" && action.type !== "leave-seat") {
    throw new Error("The game is paused until every seat is filled.");
  }

  switch (action.type) {
    case "choose-seat": {
      if (room.status === "playing" && player.seat !== null) throw new Error("Seats are locked after the game starts.");
      if (room.status !== "lobby" && room.status !== "playing") throw new Error("Seats are locked after the game starts.");
      const seatTaken = room.players.some((candidate) => candidate.id !== player.id && candidate.seat === action.seat);
      if (seatTaken) throw new Error("That seat is already taken.");
      player.seat = action.seat;
      player.leftSeat = null;
      maybeTransferHost(room, player, now);
      pushEvent(room, now, {
        type: "system",
        seat: action.seat,
        message: `${player.name} sat in Seat ${action.seat + 1}.`
      });
      break;
    }

    case "leave-seat": {
      if (player.seat === null) break;
      const seat = player.seat;
      player.seat = null;
      player.leftSeat = seat;
      if (room.status === "playing") {
        pushPlayerLeftEvent(room, now, player, seat);
      } else {
        pushEvent(room, now, {
          type: "system",
          seat,
          message: `${player.name} left Seat ${seat + 1}.`
        });
      }
      break;
    }

    case "add-bot": {
      requireHost(room, player);
      if (room.status !== "lobby") throw new Error("Bots can only be added before the game starts.");
      if (seatsAreReady(room)) throw new Error("This room is full.");
      const seatTaken = room.players.some((candidate) => candidate.seat === action.seat);
      if (seatTaken) throw new Error("That seat is already taken.");
      const botIndex = room.players.filter((candidate) => candidate.isBot).length;
      const botName = `${BOT_NAMES[botIndex % BOT_NAMES.length]} Bot`;
      const bot = createBotPlayer(botName, action.seat, now);
      room.players.push(bot);
      pushEvent(room, now, {
        type: "system",
        seat: action.seat,
        message: `${bot.name} joined Seat ${action.seat + 1}.`
      });
      break;
    }

    case "remove-bot": {
      requireHost(room, player);
      if (room.status !== "lobby") throw new Error("Bots can only be removed before the game starts.");
      const bot = room.players.find((candidate) => candidate.isBot && candidate.seat === action.seat);
      if (!bot) throw new Error("There is no bot in that seat.");
      room.players = room.players.filter((candidate) => candidate.id !== bot.id);
      pushEvent(room, now, {
        type: "system",
        seat: action.seat,
        message: `${bot.name} left Seat ${action.seat + 1}.`
      });
      break;
    }

    case "update-variants": {
      requireHost(room, player);
      if (room.status !== "lobby") throw new Error("Variants are locked after the game starts.");
      room.variants = { ...room.variants, ...assertVariantUpdate(action.variants) };
      pushEvent(room, now, {
        type: "system",
        message: "The host updated the table rules."
      });
      break;
    }

    case "start-game": {
      requireHost(room, player);
      if (room.status !== "lobby") throw new Error("The game has already started.");
      if (!seatsAreReady(room)) throw new Error("All four seats must be filled before starting.");
      room.status = "playing";
      room.game = createInitialGame(now, random);
      const dealerName = room.players.find((candidate) => candidate.seat === room.game?.dealerSeat)?.name ?? "Seat";
      pushEvent(room, now, {
        type: "system",
        message: `${dealerName} caught the first Jack and is dealer.`
      });
      break;
    }

    case "cut": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || game.phase !== "awaiting-cut") throw new Error("There is no deck to cut.");
      if (seat !== game.cutSeat) throw new Error("Only the player on the dealer's left can cut.");
      cutAndDeal(game, room.variants, room.events, now, action.cutIndex, random);
      pushEvent(room, now, {
        type: "system",
        seat,
        message: `${player.name} cut the deck.`
      });
      break;
    }

    case "stand": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || game.phase !== "begging" || seat !== nextSeat(game.dealerSeat)) {
        throw new Error("Only the player to the dealer's right can stand.");
      }
      stand(game);
      pushEvent(room, now, {
        type: "system",
        seat,
        message: `${player.name} stands.`
      });
      break;
    }

    case "beg": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || game.phase !== "begging" || seat !== nextSeat(game.dealerSeat)) {
        throw new Error("Only the player to the dealer's right can beg.");
      }
      beg(game, room.events, now);
      break;
    }

    case "take-one": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || seat !== game.dealerSeat) throw new Error("Only the dealer can take one.");
      takeOne(game, room.events, now);
      break;
    }

    case "run-cards": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || seat !== game.dealerSeat) throw new Error("Only the dealer can run the cards.");
      runCards(game, room.variants, room.events, now);
      break;
    }

    case "deck-exhausted-choice": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game || seat !== game.dealerSeat) throw new Error("Only the dealer can resolve the exhausted deck.");
      room.game = resolveDeckExhaustion(game, action.choice, room.events, now, random);
      break;
    }

    case "play-card": {
      const game = room.game;
      const seat = requireSeat(player);
      if (!game) throw new Error("There is no active game.");
      room.game = playCard(game, seat, action.cardId, room.variants, room.events, now);
      break;
    }

    case "emote": {
      requireSeat(player);
      assertCommonCall(action.call);
      pushEvent(room, now, {
        type: "emote",
        seat: player.seat ?? undefined,
        call: action.call,
        message: `${player.name}: ${action.call}`
      });
      break;
    }

    case "ack-round-summary": {
      requireHost(room, player);
      const game = room.game;
      if (!game || game.phase !== "round-summary") throw new Error("There is no round summary to close.");
      room.game = continueAfterRoundSummary(game, now, random);
      pushEvent(room, now, {
        type: "system",
        message: "The host closed the round summary. The deal passes."
      });
      break;
    }

    case "rematch": {
      requireHost(room, player);
      if (!seatsAreReady(room)) throw new Error("All four seats must be filled for a rematch.");
      room.status = "playing";
      room.game = createInitialGame(now, random);
      pushEvent(room, now, {
        type: "system",
        message: "The host started a rematch."
      });
      break;
    }

    case "end-room": {
      requireHost(room, player);
      room.status = "ended";
      if (room.game) {
        room.game.phase = "game-over";
        room.game.turnSeat = null;
      }
      pushEvent(room, now, {
        type: "system",
        message: "The host ended the room."
      });
      break;
    }

    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${JSON.stringify(_exhaustive)}`);
    }
  }

  touch(room, now);
  return room;
}

function settleReadyTrick(room: RoomDoc, now: string, random = Math.random): boolean {
  const settlingTrick = room.game?.settlingTrick;
  if (!room.game || !settlingTrick || Date.parse(settlingTrick.resolveAt) > Date.parse(now)) return false;

  room.game = settleTrickIfReady(room.game, room.events, now, room.variants, random);
  touch(room, now);
  return true;
}

function cardPlayPaused(room: RoomDoc, now: string): boolean {
  const nextPlayAt = room.game?.nextPlayAt;
  return Boolean(nextPlayAt && Date.parse(nextPlayAt) > Date.parse(now));
}

export function roomNeedsAutomation(room: RoomDoc, now: string): boolean {
  if (gameHasMissingSeats(room)) return false;
  const settlingTrick = room.game?.settlingTrick;
  return Boolean(
    (settlingTrick && Date.parse(settlingTrick.resolveAt) <= Date.parse(now)) ||
      (botForCurrentTurn(room) && !cardPlayPaused(room, now))
  );
}

export function advanceRoom(sourceRoom: RoomDoc, now: string, random = Math.random): RoomDoc {
  let room = cloneRoom(sourceRoom);
  if (gameHasMissingSeats(room)) return room;
  settleReadyTrick(room, now, random);

  for (let step = 0; step < 80; step += 1) {
    if (cardPlayPaused(room, now)) break;
    const bot = botForCurrentTurn(room);
    if (!bot) break;

    const action = chooseBotAction(room, bot);
    if (!action) break;

    room = applyRoomAction(room, bot.id, action, now, random);
    pushEvent(room, now, {
      type: "system",
      seat: bot.seat ?? undefined,
      message: `${bot.name} chose ${botActionLabel(action)}.`
    });

    if (room.game?.phase === "game-over") break;
    if (room.game?.settlingTrick) break;
  }

  return room;
}

export function advanceBots(sourceRoom: RoomDoc, now: string, random = Math.random): RoomDoc {
  return advanceRoom(sourceRoom, now, random);
}

function botActionLabel(action: RoomAction): string {
  switch (action.type) {
    case "cut":
      return "cut";
    case "stand":
      return "stand";
    case "beg":
      return "beg";
    case "take-one":
      return "take one";
    case "run-cards":
      return "run the cards";
    case "deck-exhausted-choice":
      return action.choice === "pass-pack" ? "pass the pack" : "redeal";
    case "play-card":
      return "a card";
    default:
      return "an action";
  }
}

export function sanitizeRoomForPlayer(room: RoomDoc, playerId: string): SanitizedRoomState {
  const player = room.players.find((candidate) => candidate.id === playerId);
  if (!player) throw new Error("Player is not in this room.");

  const players = publicPlayers(room);
  const game = room.game;
  const seat = player.seat;
  const gamePausedForMissingSeat = gameHasMissingSeats(room);
  const myHand = game && seat !== null && canSeeOwnHand(game, seat) ? sortCards(cloneCards(game.hands[seat])) : [];
  const teammateHand = game && seat !== null ? sortVisiblePartnerHand(game, seat) : null;
  const legalCardIds =
    game && seat !== null && !gamePausedForMissingSeat ? legalCardsForSeat(game, seat, room.variants).map((card) => card.id) : [];
  const gamePoints = game ? currentGamePoints(game) : ([0, 0] as [number, number]);

  const seats: PublicSeat[] = ([0, 1, 2, 3] as Seat[]).map((seatNumber) => ({
    seat: seatNumber,
    team: seatTeam(seatNumber),
    player: players.find((candidate) => candidate.seat === seatNumber) ?? null,
    cardCount: game ? game.hands[seatNumber].length : 0
  }));

  return {
    roomToken: room.roomToken,
    status: room.status,
    variants: room.variants,
    me: {
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      isBot: Boolean(player.isBot),
      seat: player.seat
    },
    isHost: player.id === room.hostPlayerId,
    players,
    seats,
    events: room.events.slice(-24),
    availableActions: buildAvailableActions(room, player),
    legalCardIds,
    game: {
      phase: room.status === "lobby" ? "lobby" : room.status === "ended" ? "ended" : game?.phase ?? "lobby",
      handNumber: game?.handNumber ?? 0,
      dealerSeat: game?.dealerSeat ?? null,
      cutSeat: game?.cutSeat ?? null,
      turnSeat: game?.turnSeat ?? null,
      scores: game?.scores ?? [0, 0],
      gamePoints,
      proposedTrump: game?.proposedTrump ?? null,
      trump: game?.trump ?? null,
      kickCards: game?.kickCards ?? [],
      currentTrick: game?.currentTrick ?? [],
      completedTricks: game?.completedTricks.slice(-3) ?? [],
      scoreLog: game?.scoreLog.slice(-16) ?? [],
      roundSummary: game?.roundSummary ?? null,
      winnerTeam: game?.winnerTeam ?? null,
      dealerSelection: game?.dealerSelection ?? [],
      forcedLeadSuit: game?.forcedLeadSuit ?? null,
      myHand,
      teammateHand
    }
  };
}

function sortVisiblePartnerHand(game: NonNullable<RoomDoc["game"]>, seat: Seat) {
  const hand = visiblePartnerHand(game, seat);
  return hand ? sortCards(hand) : null;
}

function currentGamePoints(game: NonNullable<RoomDoc["game"]>): [number, number] {
  return [
    game.captured[0].reduce((sum, captured) => sum + gameCardValue(captured.card.rank), 0),
    game.captured[1].reduce((sum, captured) => sum + gameCardValue(captured.card.rank), 0)
  ];
}

function buildAvailableActions(room: RoomDoc, player: PlayerRecord): PublicAction[] {
  const actions: PublicAction[] = [];

  if (room.status === "ended") {
    if (player.isHost) actions.push({ type: "rematch", label: "Start rematch" });
    return actions;
  }

  if (room.status === "lobby") {
    if (player.isHost) {
      actions.push({ type: "start-game", label: "Start game", disabled: !seatsAreReady(room) });
    }
    return actions;
  }

  if (gameHasMissingSeats(room)) return actions;

  const game = room.game;
  if (!game || player.seat === null) return actions;

  if (game.phase === "awaiting-cut" && player.seat === game.cutSeat) {
    actions.push({ type: "cut", label: "Cut deck" });
  }

  if (game.phase === "begging" && player.seat === nextSeat(game.dealerSeat)) {
    actions.push({ type: "stand", label: "Stand" }, { type: "beg", label: "I beg" });
  }

  if (game.phase === "dealer-decision" && player.seat === game.dealerSeat) {
    actions.push({ type: "take-one", label: "Give One" }, { type: "run-cards", label: "Run the Deck" });
  }

  if (game.phase === "running" && player.seat === game.dealerSeat) {
    actions.push({ type: "run-cards", label: "Keep running" });
  }

  if (game.phase === "deck-exhausted" && player.seat === game.dealerSeat) {
    if (game.roundKickPoints > 0) {
      actions.push(
        { type: "deck-exhausted-choice", label: "Keep points, pass pack", choice: "pass-pack" },
        { type: "deck-exhausted-choice", label: "Forgo points, redeal", choice: "forgo-points" }
      );
    } else {
      actions.push({ type: "deck-exhausted-choice", label: "Redeal", choice: "forgo-points" });
    }
  }

  if (game.phase === "round-summary" && player.isHost) {
    actions.push({ type: "ack-round-summary", label: "OK" });
  }

  if (game.phase === "game-over" && player.isHost) {
    actions.push({ type: "rematch", label: "Start rematch" }, { type: "end-room", label: "End room" });
  }

  return actions;
}

export function seatLabel(seat: Seat | null): string {
  return seat === null ? "No seat" : `Seat ${seat + 1}`;
}

export function partnerLabel(seat: Seat): string {
  return `Seat ${partnerSeat(seat) + 1}`;
}
