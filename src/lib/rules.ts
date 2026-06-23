import {
  cardName,
  cardStrength,
  cloneCards,
  createDeck,
  cutDeck,
  gameCardValue,
  nextSeat,
  partnerSeat,
  previousSeat,
  seatTeam,
  seatsInPlayOrder,
  shuffleDeck
} from "@/lib/cards";
import {
  type Card,
  type CompletedTrick,
  type DealtTrump,
  type GameState,
  type Hands,
  type KickingVariant,
  type RoomEvent,
  type RoomVariants,
  type RoundSummary,
  type RoundSummaryAward,
  type ScoreEvent,
  type Seat,
  type Suit,
  type Team,
  type TrickPlay
} from "@/types/game";

const TARGET_SCORE = 14;
const TRICK_SETTLE_MS = 1_000;

function emptyHands(): Hands {
  return [[], [], [], []];
}

function randomCutIndex(deck: Card[], random = Math.random): number {
  return Math.min(Math.max(Math.floor(random() * (deck.length - 2)) + 1, 1), deck.length - 1);
}

function eventId(now: string, suffix: string): string {
  return `${Date.parse(now)}-${suffix}-${Math.random().toString(36).slice(2, 8)}`;
}

export function kickingPoints(card: Card, variant: KickingVariant): number {
  if (card.rank === "A") return 1;
  if (card.rank === "6") return 2;
  if (card.rank === "J") return 3;
  if (variant === "tobago" && card.rank === "2") return 2;
  return 0;
}

export function createInitialGame(now: string, random = Math.random): GameState {
  const selectionDeck = shuffleDeck(createDeck(), random);
  const dealerSelection = [];
  let dealerSeat: Seat = 0;

  for (let i = 0; i < selectionDeck.length; i += 1) {
    const seat = (i % 4) as Seat;
    const card = selectionDeck[i];
    dealerSelection.push({ seat, card });
    if (card.rank === "J") {
      dealerSeat = seat;
      break;
    }
  }

  return prepareNewHand({
    now,
    dealerSeat,
    handNumber: 1,
    scores: [0, 0],
    dealerSelection,
    random,
    scoreLog: []
  });
}

interface PrepareHandInput {
  now: string;
  dealerSeat: Seat;
  handNumber: number;
  scores: [number, number];
  dealerSelection: GameState["dealerSelection"];
  random?: () => number;
  scoreLog: ScoreEvent[];
  roundSummary?: RoundSummary | null;
}

export function prepareNewHand({
  dealerSeat,
  handNumber,
  scores,
  dealerSelection,
  random = Math.random,
  scoreLog,
  roundSummary = null
}: PrepareHandInput): GameState {
  return {
    phase: "awaiting-cut",
    handNumber,
    dealerSeat,
    cutSeat: previousSeat(dealerSeat),
    turnSeat: previousSeat(dealerSeat),
    scores: [...scores],
    deck: shuffleDeck(createDeck(), random),
    hands: emptyHands(),
    proposedTrump: null,
    trump: null,
    kickCards: [],
    roundKickPoints: 0,
    currentTrick: [],
    nextPlayAt: null,
    settlingTrick: null,
    completedTricks: [],
    captured: [[], []],
    dealtTrumps: [],
    forcedLeadSuit: null,
    scoreLog,
    roundSummary,
    dealerSelection,
    winnerTeam: null
  };
}

function pushRoomEvent(events: RoomEvent[], event: Omit<RoomEvent, "id" | "at">, now: string): void {
  events.push({
    ...event,
    id: eventId(now, event.type),
    at: now
  });
  if (events.length > 80) {
    events.splice(0, events.length - 80);
  }
}

function addScore(
  game: GameState,
  events: RoomEvent[],
  now: string,
  scoreEvent: ScoreEvent,
  eventType: RoomEvent["type"] = "score"
): void {
  if (game.winnerTeam !== null) return;

  game.scores[scoreEvent.team] += scoreEvent.points;
  game.scoreLog.push(scoreEvent);
  pushRoomEvent(
    events,
    {
      type: eventType,
      team: scoreEvent.team,
      message: `${scoreEvent.label}: Team ${scoreEvent.team + 1} scores ${scoreEvent.points}.`
    },
    now
  );

  if (game.scores[scoreEvent.team] >= TARGET_SCORE) {
    game.winnerTeam = scoreEvent.team;
    game.phase = "game-over";
    game.turnSeat = null;
    pushRoomEvent(
      events,
      {
        type: "gameOver",
        team: scoreEvent.team,
        message: `Team ${scoreEvent.team + 1} wins ${game.scores[0]}-${game.scores[1]}.`
      },
      now
    );
  }
}

function dealCards(game: GameState, countPerPlayer: number): boolean {
  const order = seatsInPlayOrder(nextSeat(game.dealerSeat));
  for (let round = 0; round < countPerPlayer; round += 1) {
    for (const seat of order) {
      const card = game.deck.shift();
      if (!card) return false;
      game.hands[seat].push(card);
    }
  }
  return true;
}

function computeDealtTrumps(hands: Hands, trump: Suit): DealtTrump[] {
  return hands.flatMap((hand, seat) =>
    hand.filter((card) => card.suit === trump).map((card) => ({ card, seat: seat as Seat }))
  );
}

function startTrickPlay(game: GameState, trump: Suit): void {
  game.trump = trump;
  game.phase = "playing";
  game.turnSeat = nextSeat(game.dealerSeat);
  game.dealtTrumps = computeDealtTrumps(game.hands, trump);
  game.currentTrick = [];
  game.nextPlayAt = null;
  game.settlingTrick = null;
  game.completedTricks = [];
  game.captured = [[], []];
  game.forcedLeadSuit = null;
}

export function cutAndDeal(
  game: GameState,
  variants: RoomVariants,
  events: RoomEvent[],
  now: string,
  cutIndex?: number,
  random = Math.random
): void {
  if (game.phase !== "awaiting-cut") {
    throw new Error("The deck is not ready to cut.");
  }

  game.scoreLog = [];
  game.deck = cutDeck(game.deck, cutIndex ?? randomCutIndex(game.deck, random));
  game.hands = emptyHands();
  dealCards(game, 6);
  const kick = game.deck.shift();
  if (!kick) {
    throw new Error("The deck ran out before the kick.");
  }

  game.kickCards = [kick];
  game.proposedTrump = kick.suit;
  game.trump = null;
  game.roundKickPoints = 0;
  game.currentTrick = [];
  game.nextPlayAt = null;
  game.settlingTrick = null;
  game.completedTricks = [];
  game.captured = [[], []];
  game.dealtTrumps = [];

  const points = kickingPoints(kick, variants.kicking);
  if (points > 0) {
    game.roundKickPoints += points;
    addScore(
      game,
      events,
      now,
      {
        kind: "kick",
        team: seatTeam(game.dealerSeat),
        points,
        label: `${cardName(kick)} kicked`
      },
      "score"
    );
  } else {
    pushRoomEvent(
      events,
      {
        type: "system",
        message: `${cardName(kick)} was kicked. ${kick.suit} is proposed trump.`
      },
      now
    );
  }

  if (game.winnerTeam === null) {
    game.phase = "begging";
    game.turnSeat = nextSeat(game.dealerSeat);
  }
}

export function stand(game: GameState): void {
  if (game.phase !== "begging" || !game.proposedTrump) {
    throw new Error("There is no proposed trump to stand on.");
  }
  startTrickPlay(game, game.proposedTrump);
}

export function beg(game: GameState, events: RoomEvent[], now: string): void {
  if (game.phase !== "begging") {
    throw new Error("Begging is not available now.");
  }
  game.phase = "dealer-decision";
  game.turnSeat = game.dealerSeat;
  pushRoomEvent(
    events,
    {
      type: "system",
      seat: nextSeat(game.dealerSeat),
      message: "The player to the dealer's right begs."
    },
    now
  );
}

export function takeOne(game: GameState, events: RoomEvent[], now: string): void {
  if (game.phase !== "dealer-decision") {
    throw new Error("The dealer cannot take one now.");
  }
  const beggarTeam = seatTeam(nextSeat(game.dealerSeat));
  addScore(
    game,
    events,
    now,
    {
      kind: "takeOne",
      team: beggarTeam,
      points: 1,
      label: "Take one"
    },
    "score"
  );
  if (game.winnerTeam === null && game.proposedTrump) {
    startTrickPlay(game, game.proposedTrump);
  }
}

function markDeckExhausted(game: GameState, events: RoomEvent[], now: string): void {
  game.phase = "deck-exhausted";
  game.turnSeat = game.dealerSeat;
  pushRoomEvent(
    events,
    {
      type: "system",
      message:
        game.roundKickPoints > 0
          ? "The deck ran out before a new trump. The dealer must keep the kicked points and pass the pack, or forgo them and redeal."
          : "The deck ran out before a new trump. The hand must be redealt."
    },
    now
  );
}

export function runCards(
  game: GameState,
  variants: RoomVariants,
  events: RoomEvent[],
  now: string
): void {
  if (game.phase !== "dealer-decision" && game.phase !== "running") {
    throw new Error("The dealer cannot run the cards now.");
  }
  if (!game.proposedTrump) {
    throw new Error("There is no original kick suit to run from.");
  }

  if (game.deck.length < 13) {
    markDeckExhausted(game, events, now);
    return;
  }

  if (!dealCards(game, 3)) {
    markDeckExhausted(game, events, now);
    return;
  }

  const kick = game.deck.shift();
  if (!kick) {
    markDeckExhausted(game, events, now);
    return;
  }

  game.kickCards.push(kick);
  const points = kickingPoints(kick, variants.kicking);
  if (points > 0) {
    game.roundKickPoints += points;
    addScore(
      game,
      events,
      now,
      {
        kind: "kick",
        team: seatTeam(game.dealerSeat),
        points,
        label: `${cardName(kick)} kicked while running`
      },
      "score"
    );
    if (game.winnerTeam !== null) return;
  } else {
    pushRoomEvent(
      events,
      {
        type: "system",
        message: `${cardName(kick)} was kicked while running.`
      },
      now
    );
  }

  if (kick.suit !== game.proposedTrump) {
    startTrickPlay(game, kick.suit);
    return;
  }

  if (game.deck.length < 13) {
    markDeckExhausted(game, events, now);
    return;
  }

  game.phase = "running";
  game.turnSeat = game.dealerSeat;
}

export function resolveDeckExhaustion(
  game: GameState,
  choice: "pass-pack" | "forgo-points",
  events: RoomEvent[],
  now: string,
  random = Math.random
): GameState {
  if (game.phase !== "deck-exhausted") {
    throw new Error("The deck is not exhausted.");
  }

  const scores: [number, number] = [...game.scores];
  let nextDealer = game.dealerSeat;

  if (choice === "pass-pack") {
    if (game.roundKickPoints <= 0) {
      throw new Error("There are no kicked points to keep.");
    }
    nextDealer = nextSeat(game.dealerSeat);
    pushRoomEvent(
      events,
      {
        type: "system",
        message: "The dealer keeps the kicked points and passes the pack."
      },
      now
    );
  } else {
    const dealerTeam = seatTeam(game.dealerSeat);
    scores[dealerTeam] = Math.max(0, scores[dealerTeam] - game.roundKickPoints);
    pushRoomEvent(
      events,
      {
        type: "system",
        message:
          game.roundKickPoints > 0
            ? "The dealer forgoes the kicked points and redeals."
            : "The hand is redealt."
      },
      now
    );
  }

  return prepareNewHand({
    now,
    dealerSeat: nextDealer,
    handNumber: game.handNumber + 1,
    scores,
    dealerSelection: game.dealerSelection,
    random,
    scoreLog: game.scoreLog
  });
}

export function legalCardsForSeat(game: GameState, seat: Seat, variants: RoomVariants): Card[] {
  const hand = game.hands[seat];
  if (game.phase !== "playing" || game.turnSeat !== seat || !game.trump) return [];

  if (game.currentTrick.length === 0) {
    if (variants.trumpLead === "follow-suit" && game.forcedLeadSuit) {
      const forcedCards = hand.filter((card) => card.suit === game.forcedLeadSuit);
      if (forcedCards.length > 0) return cloneCards(forcedCards);
    }
    return cloneCards(hand);
  }

  const ledSuit = game.currentTrick[0].card.suit;
  const hasTrump = hand.some((card) => card.suit === game.trump);
  const hasLedSuit = hand.some((card) => card.suit === ledSuit);

  if (ledSuit === game.trump) {
    return cloneCards(hasTrump ? hand.filter((card) => card.suit === game.trump) : hand);
  }

  const applyUndertrumpRule = (cards: Card[]): Card[] => {
    const trumpToBeat = game.currentTrick
      .filter((play) => play.card.suit === game.trump)
      .sort((a, b) => cardStrength(b.card.rank) - cardStrength(a.card.rank))[0]?.card;

    if (!trumpToBeat || hand.every((card) => card.suit === game.trump)) return cards;

    return cards.filter((card) => card.suit !== game.trump || cardStrength(card.rank) > cardStrength(trumpToBeat.rank));
  };

  if (hasLedSuit) {
    return cloneCards(applyUndertrumpRule(hand.filter((card) => card.suit === ledSuit || card.suit === game.trump)));
  }

  return cloneCards(applyUndertrumpRule(hand));
}

function winningPlay(plays: TrickPlay[], trump: Suit): TrickPlay {
  const ledSuit = plays[0].card.suit;
  const trumpPlays = plays.filter((play) => play.card.suit === trump);
  const candidates = trumpPlays.length > 0 ? trumpPlays : plays.filter((play) => play.card.suit === ledSuit);
  return candidates.reduce((best, play) =>
    cardStrength(play.card.rank) > cardStrength(best.card.rank) ? play : best
  );
}

function scoreRound(
  game: GameState,
  events: RoomEvent[],
  now: string
): GameState {
  if (!game.trump) return game;

  const summary: RoundSummary = {
    handNumber: game.handNumber,
    at: now,
    high: null,
    low: null,
    jack: null,
    game: null
  };

  const high = [...game.dealtTrumps].sort((a, b) => cardStrength(b.card.rank) - cardStrength(a.card.rank))[0];
  if (high) {
    const award = roundSummaryAward({
      team: seatTeam(high.seat),
      points: 1,
      label: `High (${cardName(high.card)})`
    });
    summary.high = award;
    addScore(game, events, now, {
      kind: "high",
      ...award
    });
  }

  if (game.winnerTeam === null) {
    const low = [...game.dealtTrumps].sort((a, b) => cardStrength(a.card.rank) - cardStrength(b.card.rank))[0];
    if (low) {
      const award = roundSummaryAward({
        team: seatTeam(low.seat),
        points: 1,
        label: `Low (${cardName(low.card)})`
      });
      summary.low = award;
      addScore(game, events, now, {
        kind: "low",
        ...award
      });
    }
  }

  if (game.winnerTeam === null) {
    const jackTrick = game.completedTricks.find((trick) => trick.jackEvent);
    if (jackTrick?.jackEvent) {
      const award = roundSummaryAward({
        team: jackTrick.jackEvent.scoringTeam,
        points: jackTrick.jackEvent.kind === "hangJack" ? 3 : 1,
        label: jackTrick.jackEvent.kind === "hangJack" ? "Hang Jack" : "Jack"
      });
      summary.jack = award;
      addScore(
        game,
        events,
        now,
        {
          kind: jackTrick.jackEvent.kind,
          ...award
        }
      );
    }
  }

  if (game.winnerTeam === null) {
    const gameValues: [number, number] = [0, 0];
    game.captured.forEach((cards, team) => {
      gameValues[team as Team] = cards.reduce((sum, captured) => sum + gameCardValue(captured.card.rank), 0);
    });
    const gameTeam: Team =
      gameValues[0] === gameValues[1] ? ((seatTeam(game.dealerSeat) === 0 ? 1 : 0) as Team) : gameValues[0] > gameValues[1] ? 0 : 1;
    const award = roundSummaryAward({
      team: gameTeam,
      points: 2,
      label: `Game (${gameValues[0]}-${gameValues[1]})`
    });
    summary.game = award;
    addScore(game, events, now, {
      kind: "game",
      ...award
    });
  }

  game.roundSummary = summary;

  if (game.winnerTeam !== null) return game;

  pushRoomEvent(
    events,
    {
      type: "system",
      message: `Hand ${game.handNumber} is scored. The deal passes.`
    },
    now
  );

  game.phase = "round-summary";
  game.turnSeat = null;
  game.nextPlayAt = null;
  return game;
}

function roundSummaryAward(award: RoundSummaryAward): RoundSummaryAward {
  return award;
}

export function continueAfterRoundSummary(
  game: GameState,
  now: string,
  random = Math.random
): GameState {
  if (game.phase !== "round-summary") {
    return game;
  }

  return prepareNewHand({
    now,
    dealerSeat: nextSeat(game.dealerSeat),
    handNumber: game.handNumber + 1,
    scores: game.scores,
    dealerSelection: game.dealerSelection,
    random,
    scoreLog: game.scoreLog
  });
}

export function playCard(
  game: GameState,
  seat: Seat,
  cardId: string,
  variants: RoomVariants,
  events: RoomEvent[],
  now: string
): GameState {
  if (game.phase !== "playing" || game.turnSeat !== seat || !game.trump) {
    throw new Error("It is not this player's turn to play.");
  }

  const legal = legalCardsForSeat(game, seat, variants);
  if (!legal.some((card) => card.id === cardId)) {
    throw new Error("That card cannot be played now.");
  }

  const hand = game.hands[seat];
  const cardIndex = hand.findIndex((card) => card.id === cardId);
  if (cardIndex < 0) {
    throw new Error("That card is not in this hand.");
  }

  const [card] = hand.splice(cardIndex, 1);
  game.currentTrick.push({ seat, card });
  game.nextPlayAt = new Date(Date.parse(now) + TRICK_SETTLE_MS).toISOString();

  if (game.currentTrick.length < 4) {
    game.turnSeat = nextSeat(seat);
    return game;
  }

  const plays = [...game.currentTrick];
  const ledSuit = plays[0].card.suit;
  const winning = winningPlay(plays, game.trump);
  const winningTeam = seatTeam(winning.seat);
  const completedTrick: CompletedTrick = {
    plays,
    ledSuit,
    winnerSeat: winning.seat,
    winningCard: winning.card
  };

  const jackPlay = plays.find((play) => play.card.rank === "J" && play.card.suit === game.trump);
  if (jackPlay) {
    const jackOwnerTeam = seatTeam(jackPlay.seat);
    completedTrick.jackEvent = {
      kind: jackOwnerTeam === winningTeam ? "jack" : "hangJack",
      jackOwnerSeat: jackPlay.seat,
      scoringTeam: winningTeam
    };
    if (completedTrick.jackEvent.kind === "hangJack") {
      pushRoomEvent(
        events,
        {
          type: "hangJack",
          seat: winning.seat,
          team: winningTeam,
          message: `Hang Jack! ${cardName(jackPlay.card)} was captured by Team ${winningTeam + 1}.`
        },
        now
      );
    }
  }

  game.turnSeat = null;
  game.settlingTrick = {
    ...completedTrick,
    resolveAt: game.nextPlayAt
  };
  return game;
}

export function settleTrickIfReady(
  game: GameState,
  events: RoomEvent[],
  now: string,
  variants: RoomVariants,
  _random = Math.random
): GameState {
  void _random;
  if (!game.settlingTrick || Date.parse(game.settlingTrick.resolveAt) > Date.parse(now)) return game;

  const { plays, ledSuit, winnerSeat, winningCard, jackEvent } = game.settlingTrick;
  const completedTrick: CompletedTrick = {
    plays,
    ledSuit,
    winnerSeat,
    winningCard,
    ...(jackEvent ? { jackEvent } : {})
  };
  game.settlingTrick = null;
  return finishSettledTrick(game, completedTrick, events, now, variants);
}

function finishSettledTrick(
  game: GameState,
  completedTrick: CompletedTrick,
  events: RoomEvent[],
  now: string,
  variants: RoomVariants
): GameState {
  const winningTeam = seatTeam(completedTrick.winnerSeat);
  game.completedTricks.push(completedTrick);
  game.captured[winningTeam].push(...completedTrick.plays.map((play) => ({ card: play.card, fromSeat: play.seat })));
  game.currentTrick = [];
  game.nextPlayAt = null;

  const cardsRemaining = game.hands.some((playerHand) => playerHand.length > 0);
  if (!cardsRemaining) {
    return scoreRound(game, events, now);
  }

  if (
    variants.trumpLead === "follow-suit" &&
    completedTrick.ledSuit !== game.trump &&
    completedTrick.winningCard.suit === game.trump
  ) {
    game.forcedLeadSuit = completedTrick.ledSuit;
  } else {
    game.forcedLeadSuit = null;
  }

  game.turnSeat = completedTrick.winnerSeat;
  return game;
}

export function visiblePartnerHand(game: GameState, seat: Seat): Card[] | null {
  if (game.phase === "playing" || game.phase === "game-over" || game.completedTricks.length > 0) {
    return cloneCards(game.hands[partnerSeat(seat)]);
  }
  return null;
}

export function canSeeOwnHandDuringBegging(game: GameState, seat: Seat): boolean {
  return game.phase !== "begging" || seat === game.dealerSeat || seat === nextSeat(game.dealerSeat);
}
