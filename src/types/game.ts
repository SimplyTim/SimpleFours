export const SUITS = ["clubs", "diamonds", "hearts", "spades"] as const;
export const RANKS = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"] as const;
export const COMMON_CALLS = ["Spin", "Go on Top", "Fatten", "Shoot", "Run with Jack"] as const;

export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
export type CommonCall = (typeof COMMON_CALLS)[number];
export type Seat = 0 | 1 | 2 | 3;
export type Team = 0 | 1;

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
}

export type Hands = [Card[], Card[], Card[], Card[]];

export type KickingVariant = "trinidad" | "tobago";
export type TrumpLeadVariant = "follow-suit" | "anything";

export interface RoomVariants {
  kicking: KickingVariant;
  trumpLead: TrumpLeadVariant;
}

export interface PlayerRecord {
  id: string;
  name: string;
  secretHash: string;
  isHost: boolean;
  isBot?: boolean;
  seat: Seat | null;
  leftSeat?: Seat | null;
  joinedAt: string;
  lastSeenAt: string;
}

export type RoomStatus = "lobby" | "playing" | "ended";
export type GamePhase =
  | "awaiting-cut"
  | "begging"
  | "dealer-decision"
  | "running"
  | "deck-exhausted"
  | "playing"
  | "round-summary"
  | "game-over";

export interface TrickPlay {
  seat: Seat;
  card: Card;
}

export interface CompletedTrick {
  plays: TrickPlay[];
  ledSuit: Suit;
  winnerSeat: Seat;
  winningCard: Card;
  jackEvent?: {
    kind: "jack" | "hangJack";
    jackOwnerSeat: Seat;
    scoringTeam: Team;
  };
}

export interface SettlingTrick extends CompletedTrick {
  resolveAt: string;
}

export interface CapturedCard {
  card: Card;
  fromSeat: Seat;
}

export interface DealtTrump {
  card: Card;
  seat: Seat;
}

export interface ScoreEvent {
  kind: "kick" | "takeOne" | "high" | "low" | "jack" | "hangJack" | "game";
  team: Team;
  points: number;
  label: string;
}

export interface RoundSummaryAward {
  team: Team;
  points: number;
  label: string;
}

export interface RoundSummary {
  handNumber: number;
  at: string;
  high: RoundSummaryAward | null;
  low: RoundSummaryAward | null;
  jack: RoundSummaryAward | null;
  game: RoundSummaryAward | null;
}

export interface RoomEvent {
  id: string;
  type: "system" | "score" | "emote" | "hangJack" | "gameOver";
  message: string;
  at: string;
  seat?: Seat;
  team?: Team;
  call?: CommonCall;
}

export interface DealerSelectionDraw {
  seat: Seat;
  card: Card;
}

export interface GameState {
  phase: GamePhase;
  handNumber: number;
  dealerSeat: Seat;
  cutSeat: Seat;
  turnSeat: Seat | null;
  scores: [number, number];
  deck: Card[];
  hands: Hands;
  proposedTrump: Suit | null;
  trump: Suit | null;
  kickCards: Card[];
  roundKickPoints: number;
  currentTrick: TrickPlay[];
  nextPlayAt: string | null;
  settlingTrick: SettlingTrick | null;
  completedTricks: CompletedTrick[];
  captured: [CapturedCard[], CapturedCard[]];
  dealtTrumps: DealtTrump[];
  forcedLeadSuit: Suit | null;
  scoreLog: ScoreEvent[];
  roundSummary: RoundSummary | null;
  dealerSelection: DealerSelectionDraw[];
  winnerTeam: Team | null;
}

export interface RoomDoc {
  roomToken: string;
  status: RoomStatus;
  hostPlayerId: string;
  players: PlayerRecord[];
  variants: RoomVariants;
  game: GameState | null;
  events: RoomEvent[];
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export type RoomAction =
  | { type: "choose-seat"; seat: Seat }
  | { type: "leave-seat" }
  | { type: "add-bot"; seat: Seat }
  | { type: "remove-bot"; seat: Seat }
  | { type: "update-variants"; variants: Partial<RoomVariants> }
  | { type: "start-game" }
  | { type: "cut"; cutIndex?: number }
  | { type: "stand" }
  | { type: "beg" }
  | { type: "take-one" }
  | { type: "run-cards" }
  | { type: "deck-exhausted-choice"; choice: "pass-pack" | "forgo-points" }
  | { type: "play-card"; cardId: string }
  | { type: "emote"; call: CommonCall }
  | { type: "ack-round-summary" }
  | { type: "rematch" }
  | { type: "end-room" };

export interface PublicPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  seat: Seat | null;
}

export interface PublicSeat {
  seat: Seat;
  team: Team;
  player: PublicPlayer | null;
  cardCount: number;
}

export interface PublicAction {
  type: RoomAction["type"];
  label: string;
  disabled?: boolean;
  choice?: "pass-pack" | "forgo-points";
}

export interface SanitizedRoomState {
  roomToken: string;
  status: RoomStatus;
  variants: RoomVariants;
  me: PublicPlayer;
  isHost: boolean;
  players: PublicPlayer[];
  seats: PublicSeat[];
  events: RoomEvent[];
  availableActions: PublicAction[];
  legalCardIds: string[];
  game: {
    phase: GamePhase | "lobby" | "ended";
    handNumber: number;
    dealerSeat: Seat | null;
    cutSeat: Seat | null;
    turnSeat: Seat | null;
    scores: [number, number];
    gamePoints: [number, number];
    proposedTrump: Suit | null;
    trump: Suit | null;
    kickCards: Card[];
    currentTrick: TrickPlay[];
    completedTricks: CompletedTrick[];
    scoreLog: ScoreEvent[];
    roundSummary: RoundSummary | null;
    winnerTeam: Team | null;
    dealerSelection: DealerSelectionDraw[];
    forcedLeadSuit: Suit | null;
    myHand: Card[];
    teammateHand: Card[] | null;
  };
}
