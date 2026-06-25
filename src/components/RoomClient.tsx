"use client";

import {
  DoorOpen,
  MessageCircle,
  Play,
  RotateCcw,
  Scissors,
  Send,
  Users,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import CardView from "@/components/CardView";
import ThemeToggle from "@/components/ThemeToggle";
import { suitSymbol } from "@/lib/cards";
import {
  clearCredentials,
  fetchRoomState,
  loadCredentials,
  postRoomAction,
  saveCredentials,
  type PlayerCredentials
} from "@/lib/client-room";
import {
  COMMON_CALLS,
  type CompletedTrick,
  type RoomEvent,
  type PublicAction,
  type RoundSummaryAward,
  type RoundSummary,
  type SanitizedRoomState,
  type Seat
} from "@/types/game";

interface RoomClientProps {
  roomToken: string;
}

const SEATS: Seat[] = [0, 1, 2, 3];
const GAME_POLL_MS = 1_500;
const WAITING_POLL_MS = 4_000;

export default function RoomClient({ roomToken }: RoomClientProps) {
  const [credentials, setCredentials] = useState<PlayerCredentials | null>(null);
  const [state, setState] = useState<SanitizedRoomState | null>(null);
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [hangJackEventId, setHangJackEventId] = useState<string | null>(null);
  const [liftAnimation, setLiftAnimation] = useState<CompletedTrick | null>(null);
  const seenHangJackIds = useRef(new Set<string>());
  const seenLiftKeys = useRef(new Set<string>());
  const latestCompletedTrickRef = useRef<CompletedTrick | null>(null);
  const latestStateRef = useRef<SanitizedRoomState | null>(null);

  function syncState(nextState: SanitizedRoomState | null) {
    latestStateRef.current = nextState;
    setState(nextState);
  }

  useEffect(() => {
    setCredentials(loadCredentials(roomToken));
  }, [roomToken]);

  useEffect(() => {
    if (!credentials) return;
    const currentCredentials: PlayerCredentials = credentials;

    let cancelled = false;
    let timeout: number | null = null;

    function nextPollDelay() {
      return latestStateRef.current?.status === "playing" ? GAME_POLL_MS : WAITING_POLL_MS;
    }

    async function load() {
      try {
        const nextState = await fetchRoomState(roomToken, currentCredentials);
        if (!cancelled) {
          syncState(nextState);
        }
      } catch (caught) {
        if (!cancelled) {
          clearCredentials(roomToken);
          setCredentials(null);
          syncState(null);
          setError(caught instanceof Error ? caught.message : "Could not load room.");
        }
      } finally {
        if (!cancelled) {
          timeout = window.setTimeout(load, nextPollDelay());
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [credentials, roomToken]);

  const latestHangJack = useMemo(() => state?.events.filter((event) => event.type === "hangJack").at(-1) ?? null, [state]);
  const latestHangJackId = latestHangJack?.id ?? null;

  useEffect(() => {
    if (!latestHangJackId || seenHangJackIds.current.has(latestHangJackId)) return;
    seenHangJackIds.current.add(latestHangJackId);
    setHangJackEventId(latestHangJackId);
    const timeout = window.setTimeout(() => setHangJackEventId(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [latestHangJackId]);

  const latestCompletedTrick = state?.game.completedTricks.at(-1) ?? null;
  const latestCompletedTrickKey =
    latestCompletedTrick && state ? completedTrickKey(state.game.handNumber, latestCompletedTrick) : null;
  latestCompletedTrickRef.current = latestCompletedTrick;

  useEffect(() => {
    if (!latestCompletedTrickKey || seenLiftKeys.current.has(latestCompletedTrickKey)) return;
    const trick = latestCompletedTrickRef.current;
    if (!trick) return;
    seenLiftKeys.current.add(latestCompletedTrickKey);
    setLiftAnimation(trick);
    const timeout = window.setTimeout(() => setLiftAnimation(null), 760);
    return () => window.clearTimeout(timeout);
  }, [latestCompletedTrickKey]);

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
    setBusy("join");
    setError("");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomToken)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: joinName })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not join room.");
      const nextCredentials = {
        playerId: body.playerId as string,
        playerSecret: body.playerSecret as string
      };
      saveCredentials(roomToken, nextCredentials);
      setCredentials(nextCredentials);
      syncState(body.state as SanitizedRoomState);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join room.");
    } finally {
      setBusy(null);
    }
  }

  async function act(action: Parameters<typeof postRoomAction>[2], busyLabel: string = action.type) {
    if (!credentials) return;
    setBusy(busyLabel);
    setError("");
    try {
      syncState(await postRoomAction(roomToken, credentials, action));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  if (!credentials) {
    return (
      <main className="home-shell">
        <form className="panel compact-panel join-direct" onSubmit={joinRoom}>
          <h1>Room {roomToken}</h1>
          <label>
            Name
            <input value={joinName} onChange={(event) => setJoinName(event.target.value)} maxLength={24} required />
          </label>
          <button className="primary-button" disabled={busy !== null}>
            <DoorOpen size={18} />
            {busy === "join" ? "Joining" : "Join"}
          </button>
          {error ? <p className="error-line">{error}</p> : null}
        </form>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="room-shell">
        <div className="loading-table">Loading room {roomToken}</div>
      </main>
    );
  }

  const showEmotes = state.status === "playing" && state.me.seat !== null && state.game.phase !== "game-over";
  const visibleRoundSummary = state.game.roundSummary;

  return (
    <main className={`room-shell ${state.status === "playing" ? "playing-room-shell" : ""}`}>
      {hangJackEventId ? <HangJackOverlay /> : null}

      <header className="room-header">
        <div>
          <p className="eyebrow">Room code</p>
          <h1>{roomToken}</h1>
        </div>
        <TrumpPanel state={state} />
        <ScoreBoard state={state} />
        <ThemeToggle />
      </header>

      {state.game.phase === "lobby" ? (
        <LobbyView state={state} busy={busy} onAction={act} />
      ) : (
        <GameView
          state={state}
          busy={busy}
          showEmotes={showEmotes}
          roundSummary={visibleRoundSummary}
          liftAnimation={liftAnimation}
          onAction={act}
        />
      )}

      {error ? <RoomError message={error} onDismiss={() => setError("")} /> : null}
    </main>
  );
}

function RoomError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="room-error" role="alert">
      <span>{message}</span>
      <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss error" title="Dismiss error">
        <X size={16} />
      </button>
    </div>
  );
}

function ScoreBoard({ state }: { state: SanitizedRoomState }) {
  return (
    <div className="score-board" aria-label="Scores">
      <div className="score-row match-score-row">
        <span>Match to 14</span>
        <strong>
          <em>Team 1</em>
          {state.game.scores[0]}
        </strong>
        <strong>
          <em>Team 2</em>
          {state.game.scores[1]}
        </strong>
      </div>
      <div className="score-row game-card-row">
        <span>Game cards this hand</span>
        <strong>
          <em>Team 1</em>
          {state.game.gamePoints[0]}
        </strong>
        <strong>
          <em>Team 2</em>
          {state.game.gamePoints[1]}
        </strong>
      </div>
    </div>
  );
}

function TrumpPanel({ state }: { state: SanitizedRoomState }) {
  const trump = state.game.trump ?? state.game.proposedTrump;
  const label = state.game.trump ? "Trump" : state.game.proposedTrump ? "Proposed trump" : "Trump";

  return (
    <div className="trump-panel" aria-label="Trump and kicked cards">
      <div>
        <span>{label}</span>
        <strong>{trump ? `${suitSymbol(trump)} ${trump}` : "Not set"}</strong>
      </div>
      {state.game.kickCards.length > 0 ? (
        <div className="kick-card-strip" aria-label="Kicked cards not dealt">
          <span>Kicks not dealt</span>
          <div>
            {state.game.kickCards.map((card) => (
              <CardView key={card.id} card={card} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface LobbyViewProps {
  state: SanitizedRoomState;
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}

function LobbyView({ state, busy, onAction }: LobbyViewProps) {
  return (
    <section className="room-grid lobby-grid">
      <div className="table-zone lobby-zone">
        <div className="lobby-table-backdrop" aria-hidden="true">
          <SeatRing state={state} />
        </div>
        <LobbyRules state={state} busy={busy} onAction={onAction} />
      </div>

      <aside className="side-rail">
        <PlayersPanel state={state} busy={busy} onAction={onAction} editable />
        <ActionPanel actions={state.availableActions} busy={busy} onAction={onAction} />
        <EventLog state={state} />
      </aside>
    </section>
  );
}

function LobbyRules({ state, busy, onAction }: LobbyViewProps) {
  return (
    <div className="rules-overlay">
      <div>
        <p className="eyebrow">Table rules</p>
        <h2>All Fours Trinidad</h2>
      </div>
      <VariantPanel state={state} busy={busy} onAction={onAction} />
    </div>
  );
}

function VariantPanel({ state, busy, onAction }: LobbyViewProps) {
  return (
    <div className="variant-grid">
      <label>
        Kicking
        <select
          value={state.variants.kicking}
          disabled={!state.isHost || busy !== null}
          onChange={(event) =>
            onAction({ type: "update-variants", variants: { kicking: event.target.value as "trinidad" | "tobago" } }, "variants")
          }
        >
          <option value="trinidad">Trinidad</option>
          <option value="tobago">Tobago</option>
        </select>
      </label>
      <label>
        Trump lead
        <select
          value={state.variants.trumpLead}
          disabled={!state.isHost || busy !== null}
          onChange={(event) =>
            onAction(
              { type: "update-variants", variants: { trumpLead: event.target.value as "follow-suit" | "anything" } },
              "variants"
            )
          }
        >
          <option value="follow-suit">Trump and Follow Suit</option>
          <option value="anything">Trump and Anything</option>
        </select>
      </label>
      {!state.isHost ? <p className="subtle-text">Only the host can change table rules.</p> : null}
    </div>
  );
}

interface GameViewProps {
  state: SanitizedRoomState;
  busy: string | null;
  showEmotes: boolean;
  roundSummary: RoundSummary | null;
  liftAnimation: CompletedTrick | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}

function GameView({ state, busy, showEmotes, roundSummary, liftAnimation, onAction }: GameViewProps) {
  const roundSummaryAction = state.availableActions.find((action) => action.type === "ack-round-summary") ?? null;
  const tablePromptActions = state.availableActions.filter((action) => action.type !== "ack-round-summary");
  const boardIsBlocked = tablePromptActions.length > 0;
  const shouldKeepOwnHandClear = boardIsBlocked && state.game.myHand.length > 0;
  const waitingMessage = !boardIsBlocked && !roundSummary ? waitingStatusMessage(state) : null;
  const summaryWaitingMessage =
    state.game.phase === "round-summary" && !roundSummaryAction ? "Waiting for the host to continue." : null;

  return (
    <section className={`room-grid game-grid ${waitingMessage ? "has-floating-status" : ""}`}>
      <div className="table-zone">
        <div className="game-table">
          <div
            className={`table-play-surface ${boardIsBlocked ? "board-blurred" : ""} ${
              shouldKeepOwnHandClear ? "show-own-hand-during-prompt" : ""
            }`}
          >
            {SEATS.map((seat) => (
              <PlayerSeat key={seat} seat={seat} state={state} busy={busy} onAction={onAction} />
            ))}
            <TableCenter state={state} />
          </div>
          <LiftCaptureAnimation trick={liftAnimation} />
          <RoundSummaryOverlay
            summary={roundSummary}
            winnerTeam={state.game.winnerTeam}
            scores={state.game.scores}
            continueAction={roundSummaryAction}
            waitingMessage={summaryWaitingMessage}
            busy={busy}
            onAction={onAction}
          />
          {state.game.winnerTeam !== null && !roundSummary ? (
            <GameOverCallout winnerTeam={state.game.winnerTeam} scores={state.game.scores} />
          ) : null}
          <TableDecisionPrompt actions={tablePromptActions} busy={busy} onAction={onAction} />
          {showEmotes && !boardIsBlocked && !roundSummary ? <BoardCallMenu busy={busy} onAction={onAction} /> : null}
        </div>
      </div>
      {waitingMessage ? <WaitingStatusBanner message={waitingMessage} /> : null}

      <aside className="side-rail">
        <PlayersPanel state={state} busy={busy} onAction={onAction} />
        <RoundPanel state={state} />
        <EventLog state={state} />
      </aside>
    </section>
  );
}

function TableDecisionPrompt({
  actions,
  busy,
  onAction
}: {
  actions: PublicAction[];
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="table-decision-prompt" role="dialog" aria-label="Required table action">
      <div>
        <p className="eyebrow">Action required</p>
        <h2>{tablePromptTitle(actions)}</h2>
      </div>
      <div className="table-decision-actions">
        {actions.map((action) => (
          <button
            key={`${action.type}-${action.label}`}
            className={action.type === "stand" ? "primary-button" : "secondary-button"}
            disabled={Boolean(action.disabled) || busy !== null}
            onClick={() => onAction(toRoomAction(action), action.label)}
          >
            {iconForAction(action.type)}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundSummaryOverlay({
  summary,
  winnerTeam,
  scores,
  continueAction,
  waitingMessage,
  busy,
  onAction
}: {
  summary: RoundSummary | null;
  winnerTeam: 0 | 1 | null;
  scores: [number, number];
  continueAction: PublicAction | null;
  waitingMessage: string | null;
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}) {
  if (!summary) return null;

  return (
    <div className="round-summary-overlay" aria-live="polite">
      <div>
        <p className="eyebrow">Hand {summary.handNumber} summary</p>
        <h2>Round points</h2>
      </div>
      {winnerTeam !== null ? <GameOverCallout winnerTeam={winnerTeam} scores={scores} embedded /> : null}
      <div className="round-summary-grid">
        <SummaryAward label="High" award={summary.high} />
        <SummaryAward label="Low" award={summary.low} />
        <SummaryAward label="Jack" award={summary.jack} empty="No Jack point" />
        <SummaryAward label="Game" award={summary.game} />
      </div>
      {continueAction ? (
        <button
          className="primary-button summary-ok-button"
          disabled={busy !== null}
          onClick={() => onAction(toRoomAction(continueAction), continueAction.label)}
        >
          OK
        </button>
      ) : waitingMessage ? (
        <p className="summary-waiting">{waitingMessage}</p>
      ) : null}
    </div>
  );
}

function GameOverCallout({
  winnerTeam,
  scores,
  embedded
}: {
  winnerTeam: 0 | 1;
  scores: [number, number];
  embedded?: boolean;
}) {
  return (
    <div className={`game-over-callout ${embedded ? "embedded-game-over" : ""}`} aria-live="polite">
      <p className="eyebrow">Game over</p>
      <h2>Team {winnerTeam + 1} won</h2>
      <strong>
        {scores[0]}-{scores[1]}
      </strong>
    </div>
  );
}

function WaitingStatusBanner({ message }: { message: string }) {
  return (
    <div className="waiting-status-banner" aria-live="polite">
      <span />
      {message}
    </div>
  );
}

function LiftCaptureAnimation({ trick }: { trick: CompletedTrick | null }) {
  if (!trick) return null;

  return (
    <div className={`lift-capture-animation lift-capture-${trick.winnerSeat}`} aria-hidden="true">
      {trick.plays.map((play) => (
        <div key={`${play.seat}-${play.card.id}`} className={`center-trick-card center-trick-${play.seat}`}>
          <CardView card={play.card} small table />
        </div>
      ))}
    </div>
  );
}

function SummaryAward({
  label,
  award,
  empty = "Not awarded"
}: {
  label: string;
  award: RoundSummaryAward | null;
  empty?: string;
}) {
  return (
    <div className="summary-award">
      <span>{label}</span>
      {award ? (
        <>
          <strong>Team {award.team + 1}</strong>
          <em>+{award.points} {award.label}</em>
        </>
      ) : (
        <em>{empty}</em>
      )}
    </div>
  );
}

function PlayersPanel({
  state,
  busy,
  onAction,
  editable
}: {
  state: SanitizedRoomState;
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
  editable?: boolean;
}) {
  return (
    <div className="panel players-panel">
      <h2>
        <Users size={18} />
        Players
      </h2>
      <div className="seat-list">
        {state.seats.map((seat) => (
          <div key={seat.seat} className="seat-control-row">
            <button
              className={`seat-row team-seat-${seat.team} ${state.me.seat === seat.seat ? "selected-seat" : ""}`}
              disabled={!editable || Boolean(seat.player && seat.player.id !== state.me.id) || busy !== null}
              onClick={() => onAction({ type: "choose-seat", seat: seat.seat }, `seat-${seat.seat}`)}
            >
              <span>
                Seat {seat.seat + 1}
                <em>Team {seat.team + 1}</em>
              </span>
              <strong>{seat.player?.name ?? "Open"}</strong>
              <small>
                {seat.player?.isBot
                  ? "Bot player"
                  : state.status === "playing"
                    ? `${seat.cardCount} cards`
                    : "Opposite partners"}
              </small>
            </button>
            {editable && state.isHost && !seat.player ? (
              <button className="bot-seat-button" disabled={busy !== null} onClick={() => onAction({ type: "add-bot", seat: seat.seat }, `bot-${seat.seat}`)}>
                Add bot
              </button>
            ) : null}
            {editable && state.isHost && seat.player?.isBot ? (
              <button className="bot-seat-button remove-bot-button" disabled={busy !== null} onClick={() => onAction({ type: "remove-bot", seat: seat.seat }, `bot-${seat.seat}`)}>
                Remove
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function SeatRing({ state, onSeat }: { state: SanitizedRoomState; onSeat?: (seat: Seat) => void }) {
  return (
    <div className="seat-ring">
      {state.seats.map((seat) => (
        <button
          key={seat.seat}
          className={`seat-puck seat-${seat.seat} team-seat-${seat.team} ${state.me.seat === seat.seat ? "selected-seat" : ""}`}
          disabled={!onSeat || Boolean(seat.player && seat.player.id !== state.me.id)}
          onClick={() => onSeat?.(seat.seat)}
        >
          <span>Seat {seat.seat + 1}</span>
          <strong>{seat.player?.name ?? "Open"}</strong>
          <em>Team {seat.team + 1}</em>
        </button>
      ))}
      <div className="felt-center">SimpleFours</div>
    </div>
  );
}

function PlayerSeat({
  seat,
  state,
  busy,
  onAction
}: {
  seat: Seat;
  state: SanitizedRoomState;
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}) {
  const seatInfo = state.seats.find((candidate) => candidate.seat === seat);
  const player = seatInfo?.player;
  const isMe = state.me.seat === seat;
  const isPartner = state.me.seat !== null && (state.me.seat + 2) % 4 === seat;
  const visibleHand = isMe ? state.game.myHand : isPartner ? state.game.teammateHand ?? [] : [];
  const isTurn = state.game.turnSeat === seat;
  const isDealer = state.game.dealerSeat === seat;
  const isCut = state.game.cutSeat === seat && state.game.phase === "awaiting-cut";
  const emote = latestEmoteForSeat(state, seat);

  return (
    <section
      className={`player-seat player-seat-${seat} team-seat-${seatInfo?.team ?? 0} ${isMe ? "my-seat" : ""} ${
        isTurn ? "turn-seat" : ""
      }`}
    >
      {emote ? <div className="emote-bubble">{emote.call}</div> : null}
      <div className="seat-title">
        <span>{player?.name ?? `Seat ${seat + 1}`}</span>
        <small>{player?.isBot ? "Bot" : `Team ${(seatInfo?.team ?? 0) + 1}`}</small>
      </div>
      <div className="badges">
        {isMe ? <span>Me</span> : null}
        {isDealer ? <span>Dealer</span> : null}
        {isCut ? <span>Cut</span> : null}
        {isTurn ? <span>Turn</span> : null}
      </div>
      <div className="hand-row">
        {visibleHand.length > 0
          ? visibleHand.map((card) => {
              const playable = isMe && state.legalCardIds.includes(card.id);
              return (
                <CardView
                  key={card.id}
                  card={card}
                  playable={playable}
                  disabled={!playable || busy !== null}
                  onClick={playable ? () => onAction({ type: "play-card", cardId: card.id }, `card-${card.id}`) : undefined}
                  small={!isMe}
                />
              );
            })
          : Array.from({ length: Math.min(seatInfo?.cardCount ?? 0, 12) }).map((_, index) => <CardView key={index} small />)}
      </div>
    </section>
  );
}

function TableCenter({ state }: { state: SanitizedRoomState }) {
  const trickBySeat = new Map(state.game.currentTrick.map((play) => [play.seat, play.card]));
  return (
    <div className="table-center" aria-label="Cards on the table">
      {SEATS.map((seat) => (
        <div key={seat} className={`center-trick-card center-trick-${seat}`}>
          {trickBySeat.has(seat) ? <CardView card={trickBySeat.get(seat)} small table /> : null}
        </div>
      ))}
    </div>
  );
}

function RoundPanel({ state }: { state: SanitizedRoomState }) {
  return (
    <div className="panel">
      <h2>
        <Scissors size={18} />
        Hand {state.game.handNumber || 1}
      </h2>
      <div className="round-lines">
        <p>Dealer: {seatText(state.game.dealerSeat)}</p>
        <p>Turn: {seatText(state.game.turnSeat)}</p>
        {state.game.forcedLeadSuit ? <p>Lead: {state.game.forcedLeadSuit}</p> : null}
        {state.game.winnerTeam !== null ? <p>Winner: Team {state.game.winnerTeam + 1}</p> : null}
      </div>
      {state.game.scoreLog.length > 0 ? (
        <div className="score-log">
          {state.game.scoreLog.slice(-5).map((score, index) => (
            <p key={`${score.kind}-${index}`}>
              <strong>Team {score.team + 1}</strong> +{score.points} {score.label}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionPanel({
  actions,
  busy,
  onAction
}: {
  actions: PublicAction[];
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}) {
  if (actions.length === 0) return null;

  return (
    <div className="panel">
      <h2>
        <Play size={18} />
        Actions
      </h2>
      <div className="action-stack">
        {actions.map((action) => (
          <button
            key={`${action.type}-${action.label}`}
            className="secondary-button"
            disabled={Boolean(action.disabled) || busy !== null}
            onClick={() => onAction(toRoomAction(action), action.label)}
          >
            {iconForAction(action.type)}
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function BoardCallMenu({
  busy,
  onAction
}: {
  busy: string | null;
  onAction: (action: Parameters<typeof postRoomAction>[2], busyLabel?: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  async function sendCall(call: (typeof COMMON_CALLS)[number]) {
    setOpen(false);
    await onAction({ type: "emote", call }, call);
  }

  return (
    <div className="board-call-menu">
      <button
        type="button"
        className="board-call-toggle"
        aria-label={open ? "Close table calls" : "Open table calls"}
        aria-expanded={open}
        disabled={busy !== null}
        onClick={() => setOpen((current) => !current)}
      >
        <MessageCircle size={21} />
      </button>
      {open ? (
        <div className="board-call-popover" role="menu" aria-label="Table calls">
          <p className="eyebrow">Table calls</p>
          {COMMON_CALLS.map((call) => (
            <button key={call} className="call-button" role="menuitem" disabled={busy !== null} onClick={() => sendCall(call)}>
              <Send size={15} />
              {call}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EventLog({ state }: { state: SanitizedRoomState }) {
  return (
    <div className="panel event-panel">
      <h2>
        <MessageCircle size={18} />
        Table
      </h2>
      <div className="event-log">
        {state.events.slice(-10).map((event) => (
          <p key={event.id} className={`event-line ${event.type === "hangJack" ? "hot-event" : ""}`}>
            {event.message}
          </p>
        ))}
      </div>
    </div>
  );
}

function latestEmoteForSeat(state: SanitizedRoomState, seat: Seat): RoomEvent | null {
  const emote = state.events
    .filter((event) => event.type === "emote" && event.seat === seat)
    .at(-1);
  if (!emote) return null;
  return Date.now() - Date.parse(emote.at) < 3_000 ? emote : null;
}

function HangJackOverlay() {
  return (
    <div className="hang-overlay" aria-live="polite">
      <div className="gallows">
        <span className="beam top" />
        <span className="beam post" />
        <span className="beam base" />
        <span className="beam rope" />
        <div className="hanging-card">
          <span>J</span>
          <strong>TRUMP</strong>
        </div>
      </div>
      <strong>Hang Jack</strong>
    </div>
  );
}

function toRoomAction(action: PublicAction): Parameters<typeof postRoomAction>[2] {
  switch (action.type) {
    case "start-game":
      return { type: "start-game" };
    case "cut":
      return { type: "cut" };
    case "stand":
      return { type: "stand" };
    case "beg":
      return { type: "beg" };
    case "take-one":
      return { type: "take-one" };
    case "run-cards":
      return { type: "run-cards" };
    case "deck-exhausted-choice":
      return { type: "deck-exhausted-choice", choice: action.choice ?? "forgo-points" };
    case "ack-round-summary":
      return { type: "ack-round-summary" };
    case "rematch":
      return { type: "rematch" };
    case "end-room":
      return { type: "end-room" };
    default:
      return { type: "end-room" };
  }
}

function iconForAction(actionType: PublicAction["type"]) {
  if (actionType === "cut") return <Scissors size={17} />;
  if (actionType === "rematch") return <RotateCcw size={17} />;
  if (actionType === "end-room") return <DoorOpen size={17} />;
  return <Play size={17} />;
}

function tablePromptTitle(actions: PublicAction[]): string {
  const types = new Set(actions.map((action) => action.type));
  if (types.has("stand") || types.has("beg")) return "Stand or beg?";
  if (types.has("take-one") || types.has("run-cards")) return "Take one or run?";
  if (types.has("deck-exhausted-choice")) return "Resolve the exhausted deck";
  if (types.has("cut")) return "Cut the deck";
  if (types.has("rematch")) return "Start a new game?";
  return "Choose an action";
}

function waitingStatusMessage(state: SanitizedRoomState): string | null {
  const phase = state.game.phase;
  if (phase === "awaiting-cut") return `Waiting for ${seatName(state, state.game.cutSeat)} to cut.`;
  if (phase === "begging") return `Waiting for ${seatName(state, seatToDealerRight(state.game.dealerSeat))} to stand or beg.`;
  if (phase === "dealer-decision") return `Waiting for ${seatName(state, state.game.dealerSeat)} to take one or run the cards.`;
  if (phase === "running") return `Waiting for ${seatName(state, state.game.dealerSeat)} to keep running.`;
  if (phase === "deck-exhausted") return `Waiting for ${seatName(state, state.game.dealerSeat)} to resolve the deck.`;
  if (phase === "playing") {
    if (state.game.turnSeat === null) return "Resolving the lift.";
    if (state.me.seat !== state.game.turnSeat) return `Waiting for ${seatName(state, state.game.turnSeat)} to play.`;
  }
  return null;
}

function seatName(state: SanitizedRoomState, seat: Seat | null): string {
  if (seat === null) return "another player";
  return state.seats.find((candidate) => candidate.seat === seat)?.player?.name ?? `Seat ${seat + 1}`;
}

function seatToDealerRight(dealerSeat: Seat | null): Seat | null {
  return dealerSeat === null ? null : (((dealerSeat + 1) % 4) as Seat);
}

function completedTrickKey(handNumber: number, trick: CompletedTrick): string {
  return `${handNumber}-${trick.winnerSeat}-${trick.plays.map((play) => `${play.seat}:${play.card.id}`).join("|")}`;
}

function seatText(seat: Seat | null): string {
  return seat === null ? "None" : `Seat ${seat + 1}`;
}
