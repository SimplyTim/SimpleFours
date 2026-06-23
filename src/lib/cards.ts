import { RANKS, SUITS, type Card, type Rank, type Seat, type Suit, type Team } from "@/types/game";

const SUIT_ORDER: Record<Suit, number> = {
  spades: 0,
  hearts: 1,
  diamonds: 2,
  clubs: 3
};

const RANK_STRENGTH: Record<Rank, number> = {
  A: 13,
  K: 12,
  Q: 11,
  J: 10,
  "10": 9,
  "9": 8,
  "8": 7,
  "7": 6,
  "6": 5,
  "5": 4,
  "4": 3,
  "3": 2,
  "2": 1
};

const GAME_VALUES: Record<Rank, number> = {
  A: 4,
  K: 3,
  Q: 2,
  J: 1,
  "10": 10,
  "9": 0,
  "8": 0,
  "7": 0,
  "6": 0,
  "5": 0,
  "4": 0,
  "3": 0,
  "2": 0
};

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ id: `${rank}-${suit}`, rank, suit })));
}

export function shuffleDeck(deck: Card[], random = Math.random): Card[] {
  const shuffled = [...deck];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function cutDeck(deck: Card[], cutIndex: number): Card[] {
  const safeIndex = Math.min(Math.max(cutIndex, 1), deck.length - 1);
  return [...deck.slice(safeIndex), ...deck.slice(0, safeIndex)];
}

export function cardStrength(rank: Rank): number {
  return RANK_STRENGTH[rank];
}

export function gameCardValue(rank: Rank): number {
  return GAME_VALUES[rank];
}

export function cardName(card: Card): string {
  return `${card.rank} of ${card.suit}`;
}

export function suitSymbol(suit: Suit): string {
  return {
    clubs: "\u2663",
    diamonds: "\u2666",
    hearts: "\u2665",
    spades: "\u2660"
  }[suit];
}

export function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const suitDiff = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) return suitDiff;
    return cardStrength(b.rank) - cardStrength(a.rank);
  });
}

export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % 4) as Seat;
}

export function previousSeat(seat: Seat): Seat {
  return ((seat + 3) % 4) as Seat;
}

export function partnerSeat(seat: Seat): Seat {
  return ((seat + 2) % 4) as Seat;
}

export function seatTeam(seat: Seat): Team {
  return (seat % 2) as Team;
}

export function seatsInPlayOrder(fromSeat: Seat): Seat[] {
  return [fromSeat, nextSeat(fromSeat), nextSeat(nextSeat(fromSeat)), previousSeat(fromSeat)];
}

export function cloneCard(card: Card): Card {
  return { ...card };
}

export function cloneCards(cards: Card[]): Card[] {
  return cards.map(cloneCard);
}
