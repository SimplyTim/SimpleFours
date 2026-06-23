import { describe, expect, it } from "vitest";
import { createDeck } from "@/lib/cards";
import {
  createInitialGame,
  continueAfterRoundSummary,
  cutAndDeal,
  kickingPoints,
  legalCardsForSeat,
  playCard,
  resolveDeckExhaustion,
  runCards,
  settleTrickIfReady
} from "@/lib/rules";
import type { Card, GameState, RoomEvent, RoomVariants } from "@/types/game";

const variants: RoomVariants = { kicking: "trinidad", trumpLead: "follow-suit" };
const now = "2026-06-19T00:00:00.000Z";
const afterTrickHold = "2026-06-19T00:00:01.000Z";

function card(id: string): Card {
  const found = createDeck().find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Missing card ${id}`);
  return found;
}

function basePlayingGame(): GameState {
  return {
    phase: "playing",
    handNumber: 1,
    dealerSeat: 0,
    cutSeat: 3,
    turnSeat: 0,
    scores: [0, 0],
    deck: [],
    hands: [[card("A-spades")], [card("K-hearts")], [card("2-clubs")], [card("3-diamonds")]],
    proposedTrump: "spades",
    trump: "spades",
    kickCards: [],
    roundKickPoints: 0,
    currentTrick: [],
    nextPlayAt: null,
    settlingTrick: null,
    completedTricks: [],
    captured: [[], []],
    dealtTrumps: [{ card: card("A-spades"), seat: 0 }],
    forcedLeadSuit: null,
    scoreLog: [],
    roundSummary: null,
    dealerSelection: [],
    winnerTeam: null
  };
}

describe("rules engine", () => {
  it("scores Trinidad and Tobago kicking variants", () => {
    expect(kickingPoints(card("A-spades"), "trinidad")).toBe(1);
    expect(kickingPoints(card("6-hearts"), "trinidad")).toBe(2);
    expect(kickingPoints(card("J-clubs"), "trinidad")).toBe(3);
    expect(kickingPoints(card("2-diamonds"), "trinidad")).toBe(0);
    expect(kickingPoints(card("2-diamonds"), "tobago")).toBe(2);
  });

  it("enforces led suit, trumping, and no off-suit discard when the led suit is held", () => {
    const game = basePlayingGame();
    game.hands[0] = [card("K-hearts"), card("2-spades"), card("3-clubs")];
    game.currentTrick = [{ seat: 3, card: card("4-hearts") }];
    game.turnSeat = 0;

    expect(legalCardsForSeat(game, 0, variants).map((legal) => legal.id).sort()).toEqual(["2-spades", "K-hearts"]);
  });

  it("forces trump when trump is led", () => {
    const game = basePlayingGame();
    game.hands[0] = [card("K-hearts"), card("2-spades")];
    game.currentTrick = [{ seat: 3, card: card("4-spades") }];
    game.turnSeat = 0;

    expect(legalCardsForSeat(game, 0, variants).map((legal) => legal.id)).toEqual(["2-spades"]);
  });

  it("lets the next human card be played while the previous card remains visible", () => {
    const game = basePlayingGame();
    game.hands = [[], [card("K-hearts")], [], []];
    game.currentTrick = [{ seat: 0, card: card("A-hearts") }];
    game.turnSeat = 1;
    game.nextPlayAt = afterTrickHold;

    const next = playCard(game, 1, "K-hearts", variants, [], now);
    expect(next.currentTrick.map((play) => play.card.id)).toEqual(["A-hearts", "K-hearts"]);
  });

  it("forces the original led suit after a trump wins under Trump and Follow Suit", () => {
    const game = basePlayingGame();
    game.turnSeat = 3;
    game.hands = [[], [], [], [card("3-spades"), card("5-hearts")]];
    game.currentTrick = [
      { seat: 0, card: card("K-hearts") },
      { seat: 1, card: card("2-spades") },
      { seat: 2, card: card("3-hearts") }
    ];
    game.dealtTrumps = [{ card: card("2-spades"), seat: 1 }];

    const next = playCard(game, 3, "3-spades", variants, [], now);
    expect(next.currentTrick).toHaveLength(4);
    expect(next.turnSeat).toBeNull();

    const settled = settleTrickIfReady(next, [], afterTrickHold, variants, () => 0);
    expect(settled.forcedLeadSuit).toBe("hearts");
    expect(settled.turnSeat).toBe(3);
  });

  it("awards High before Low at 13-13", () => {
    const game = basePlayingGame();
    game.scores = [13, 13];
    game.turnSeat = 3;
    game.hands = [[], [], [], [card("4-hearts")]];
    game.currentTrick = [
      { seat: 0, card: card("K-hearts") },
      { seat: 1, card: card("2-hearts") },
      { seat: 2, card: card("3-hearts") }
    ];
    game.dealtTrumps = [
      { card: card("A-spades"), seat: 0 },
      { card: card("2-spades"), seat: 1 }
    ];

    const next = playCard(game, 3, "4-hearts", variants, [], now);
    const settled = settleTrickIfReady(next, [], afterTrickHold, variants, () => 0);
    expect(settled.winnerTeam).toBe(0);
    expect(settled.scores).toEqual([14, 13]);
  });

  it("records Hang Jack when the opposing team captures trump Jack", () => {
    const game = basePlayingGame();
    const events: RoomEvent[] = [];
    game.turnSeat = 3;
    game.hands = [[], [], [], [card("3-spades")]];
    game.currentTrick = [
      { seat: 0, card: card("A-spades") },
      { seat: 1, card: card("J-spades") },
      { seat: 2, card: card("2-spades") }
    ];
    game.dealtTrumps = [
      { card: card("A-spades"), seat: 0 },
      { card: card("J-spades"), seat: 1 },
      { card: card("2-spades"), seat: 2 },
      { card: card("3-spades"), seat: 3 }
    ];

    const next = playCard(game, 3, "3-spades", variants, events, now);
    expect(events.some((event) => event.type === "hangJack")).toBe(true);
    expect(next.scoreLog.some((score) => score.kind === "hangJack")).toBe(false);
    expect(next.scores).toEqual([0, 0]);
    const settled = settleTrickIfReady(next, events, afterTrickHold, variants, () => 0);
    expect(settled.scoreLog.some((score) => score.kind === "hangJack" && score.team === 0 && score.points === 3)).toBe(true);
    expect(events.some((event) => event.type === "score" && event.message.includes("Hang Jack"))).toBe(true);
    expect(settled.roundSummary?.jack?.label).toBe("Hang Jack");
    expect(settled.roundSummary?.game?.label).toBe("Game (5-0)");
    expect(settled.phase).toBe("round-summary");
    expect(settled.nextPlayAt).toBeNull();
  });

  it("waits for the host to close the round summary before preparing the next hand", () => {
    const game = basePlayingGame();
    game.turnSeat = 3;
    game.hands = [[], [], [], [card("4-hearts")]];
    game.currentTrick = [
      { seat: 0, card: card("K-hearts") },
      { seat: 1, card: card("2-hearts") },
      { seat: 2, card: card("3-hearts") }
    ];
    game.dealtTrumps = [{ card: card("A-spades"), seat: 0 }];

    const next = playCard(game, 3, "4-hearts", variants, [], now);
    const settled = settleTrickIfReady(next, [], afterTrickHold, variants, () => 0);
    const ready = continueAfterRoundSummary(settled, afterTrickHold, () => 0);

    expect(ready.phase).toBe("awaiting-cut");
    expect(ready.handNumber).toBe(2);
    expect(ready.roundSummary).toBeNull();
  });

  it("prevents undertrumping unless the player has a flush trump hand", () => {
    const game = basePlayingGame();
    game.currentTrick = [
      { seat: 1, card: card("4-hearts") },
      { seat: 2, card: card("K-spades") }
    ];
    game.turnSeat = 3;
    game.hands[3] = [card("5-hearts"), card("Q-spades"), card("A-spades"), card("2-clubs")];

    expect(legalCardsForSeat(game, 3, variants).map((legal) => legal.id).sort()).toEqual(["5-hearts", "A-spades"]);

    game.hands[3] = [card("Q-spades"), card("2-spades")];
    expect(legalCardsForSeat(game, 3, variants).map((legal) => legal.id).sort()).toEqual(["2-spades", "Q-spades"]);
  });

  it("allows a non-trump discard instead of undertrumping when the led suit is gone", () => {
    const game = basePlayingGame();
    game.currentTrick = [
      { seat: 1, card: card("4-hearts") },
      { seat: 2, card: card("K-spades") }
    ];
    game.turnSeat = 3;
    game.hands[3] = [card("Q-spades"), card("2-clubs"), card("A-spades")];

    expect(legalCardsForSeat(game, 3, variants).map((legal) => legal.id).sort()).toEqual(["2-clubs", "A-spades"]);
  });

  it("holds the fourth played card on the table before settling the trick", () => {
    const game = basePlayingGame();
    game.turnSeat = 3;
    game.hands = [[card("A-clubs")], [card("K-clubs")], [card("Q-clubs")], [card("4-hearts"), card("J-clubs")]];
    game.currentTrick = [
      { seat: 0, card: card("K-hearts") },
      { seat: 1, card: card("2-hearts") },
      { seat: 2, card: card("3-hearts") }
    ];

    const next = playCard(game, 3, "4-hearts", variants, [], now);
    expect(next.currentTrick).toHaveLength(4);
    expect(next.settlingTrick?.resolveAt).toBe(afterTrickHold);
    expect(next.completedTricks).toHaveLength(0);

    const tooSoon = settleTrickIfReady(next, [], now, variants, () => 0);
    expect(tooSoon.currentTrick).toHaveLength(4);

    const settled = settleTrickIfReady(tooSoon, [], afterTrickHold, variants, () => 0);
    expect(settled.currentTrick).toHaveLength(0);
    expect(settled.completedTricks).toHaveLength(1);
  });

  it("allows the dealer to forgo kicked points and redeal after deck exhaustion", () => {
    const game = createInitialGame(now, () => 0);
    game.phase = "dealer-decision";
    game.dealerSeat = 0;
    game.turnSeat = 0;
    game.scores = [2, 0];
    game.roundKickPoints = 2;
    game.proposedTrump = "clubs";
    game.deck = createDeck().slice(0, 4);
    const events: RoomEvent[] = [];

    runCards(game, variants, events, now);
    expect(game.phase).toBe("deck-exhausted");

    const next = resolveDeckExhaustion(game, "forgo-points", events, now, () => 0);
    expect(next.phase).toBe("awaiting-cut");
    expect(next.scores).toEqual([0, 0]);
    expect(next.dealerSeat).toBe(0);
  });

  it("lets kicked points win immediately before play", () => {
    const game = createInitialGame(now, () => 0);
    const deck = createDeck();
    const kick = card("A-spades");
    const rest = deck.filter((candidate) => candidate.id !== kick.id);
    game.dealerSeat = 0;
    game.cutSeat = 3;
    game.turnSeat = 3;
    game.scores = [13, 0];
    game.deck = [rest[0], ...rest.slice(1, 25), kick, ...rest.slice(25)];
    const events: RoomEvent[] = [];

    cutAndDeal(game, variants, events, now, 1, () => 0);
    expect(game.phase).toBe("game-over");
    expect(game.winnerTeam).toBe(0);
    expect(game.scores[0]).toBe(14);
  });
});
