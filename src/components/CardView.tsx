import { suitSymbol } from "@/lib/cards";
import type { Card } from "@/types/game";

interface CardViewProps {
  card?: Card;
  disabled?: boolean;
  playable?: boolean;
  onClick?: () => void;
  small?: boolean;
  table?: boolean;
}

export default function CardView({ card, disabled, playable, onClick, small, table }: CardViewProps) {
  if (!card) {
    return <span className={`playing-card card-back ${small ? "small-card" : ""} ${table ? "table-card" : ""}`} aria-label="Hidden card" />;
  }

  const red = card.suit === "diamonds" || card.suit === "hearts";
  const face = (
    <span className="card-face">
      <span className="card-rank">{card.rank}</span>
      <strong className="card-suit-main">{suitSymbol(card.suit)}</strong>
    </span>
  );
  const className = [
    "playing-card",
    small ? "small-card" : "",
    table ? "table-card" : "",
    red ? "red-card" : "black-card",
    playable ? "playable-card" : ""
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button className={className} disabled={disabled} onClick={onClick} aria-label={`Play ${card.rank} of ${card.suit}`}>
        {face}
      </button>
    );
  }

  return (
    <span className={className} aria-label={`${card.rank} of ${card.suit}`}>
      {face}
    </span>
  );
}
