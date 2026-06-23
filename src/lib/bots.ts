import { cardStrength, gameCardValue, seatTeam } from "@/lib/cards";
import { legalCardsForSeat } from "@/lib/rules";
import type { Card, PlayerRecord, RoomAction, RoomDoc, Seat, Suit, TrickPlay } from "@/types/game";

export function botForCurrentTurn(room: RoomDoc): PlayerRecord | null {
  if (room.status !== "playing" || !room.game || room.game.turnSeat === null) return null;
  return room.players.find((player) => player.isBot && player.seat === room.game?.turnSeat) ?? null;
}

export function chooseBotAction(room: RoomDoc, bot: PlayerRecord): RoomAction | null {
  const game = room.game;
  if (!game || bot.seat === null || bot.seat !== game.turnSeat) return null;

  switch (game.phase) {
    case "awaiting-cut":
      return bot.seat === game.cutSeat ? { type: "cut" } : null;

    case "begging":
      return shouldStand(room, bot.seat) ? { type: "stand" } : { type: "beg" };

    case "dealer-decision":
      return shouldTakeOne(room, bot.seat) ? { type: "take-one" } : { type: "run-cards" };

    case "running":
      return { type: "run-cards" };

    case "deck-exhausted":
      return { type: "deck-exhausted-choice", choice: game.roundKickPoints > 0 ? "pass-pack" : "forgo-points" };

    case "playing": {
      const card = chooseBotCard(room, bot.seat);
      return card ? { type: "play-card", cardId: card.id } : null;
    }

    default:
      return null;
  }
}

function shouldStand(room: RoomDoc, seat: Seat): boolean {
  const game = room.game;
  if (!game?.proposedTrump) return true;
  const hand = game.hands[seat];
  const trumpCards = hand.filter((card) => card.suit === game.proposedTrump);
  const strength = trumpCards.reduce((sum, card) => sum + cardStrength(card.rank), 0);
  return trumpCards.length >= 2 || strength >= 20 || trumpCards.some((card) => card.rank === "J");
}

function shouldTakeOne(room: RoomDoc, seat: Seat): boolean {
  const game = room.game;
  if (!game?.proposedTrump) return true;
  const hand = game.hands[seat];
  const trumpCards = hand.filter((card) => card.suit === game.proposedTrump);
  const highTrumpCount = trumpCards.filter((card) => cardStrength(card.rank) >= cardStrength("J")).length;
  return trumpCards.length >= 3 || highTrumpCount >= 2 || trumpCards.some((card) => card.rank === "J");
}

function chooseBotCard(room: RoomDoc, seat: Seat): Card | null {
  const game = room.game;
  if (!game?.trump) return null;
  const trump = game.trump;

  const legal = legalCardsForSeat(game, seat, room.variants);
  if (legal.length === 0) return null;

  if (game.currentTrick.length === 0) {
    return chooseLeadCard(legal, trump);
  }

  const currentWinner = winningPlay(game.currentTrick, trump);
  if (seatTeam(currentWinner.seat) === seatTeam(seat)) {
    return chooseFattenCard(legal, trump);
  }

  const winningCards = legal.filter((card) => cardBeats(card, currentWinner.card, game.currentTrick[0].card.suit, trump));
  if (winningCards.length > 0) {
    return lowestCostCard(winningCards, trump);
  }

  return lowestCostCard(legal, trump);
}

function chooseLeadCard(legal: Card[], trump: Suit): Card {
  const trumpJack = legal.find((card) => card.suit === trump && card.rank === "J");
  if (trumpJack && legal.filter((card) => card.suit === trump).length <= 2) return trumpJack;

  const nonTrump = legal.filter((card) => card.suit !== trump);
  return lowestCostCard(nonTrump.length > 0 ? nonTrump : legal, trump);
}

function chooseFattenCard(legal: Card[], trump: Suit): Card {
  return [...legal].sort((a, b) => {
    const gameDiff = gameCardValue(b.rank) - gameCardValue(a.rank);
    if (gameDiff !== 0) return gameDiff;
    return cardCost(a, trump) - cardCost(b, trump);
  })[0];
}

function lowestCostCard(cards: Card[], trump: Suit): Card {
  return [...cards].sort((a, b) => cardCost(a, trump) - cardCost(b, trump))[0];
}

function cardCost(card: Card, trump: Suit): number {
  const trumpCost = card.suit === trump ? 100 : 0;
  const jackRisk = card.suit === trump && card.rank === "J" ? 40 : 0;
  return trumpCost + jackRisk + gameCardValue(card.rank) * 5 + cardStrength(card.rank);
}

function winningPlay(plays: TrickPlay[], trump: Suit): TrickPlay {
  const ledSuit = plays[0].card.suit;
  const trumpPlays = plays.filter((play) => play.card.suit === trump);
  const candidates = trumpPlays.length > 0 ? trumpPlays : plays.filter((play) => play.card.suit === ledSuit);
  return candidates.reduce((best, play) =>
    cardStrength(play.card.rank) > cardStrength(best.card.rank) ? play : best
  );
}

function cardBeats(candidate: Card, currentWinner: Card, ledSuit: Suit, trump: Suit): boolean {
  if (currentWinner.suit === trump) {
    return candidate.suit === trump && cardStrength(candidate.rank) > cardStrength(currentWinner.rank);
  }

  if (candidate.suit === trump) return true;
  return candidate.suit === ledSuit && cardStrength(candidate.rank) > cardStrength(currentWinner.rank);
}
