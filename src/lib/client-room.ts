import type { RoomAction, SanitizedRoomState } from "@/types/game";

export interface PlayerCredentials {
  playerId: string;
  playerSecret: string;
}

function storageKey(roomToken: string): string {
  return `simplefours:${roomToken}:credentials`;
}

export function saveCredentials(roomToken: string, credentials: PlayerCredentials): void {
  window.localStorage.setItem(storageKey(roomToken), JSON.stringify(credentials));
}

export function loadCredentials(roomToken: string): PlayerCredentials | null {
  const raw = window.localStorage.getItem(storageKey(roomToken));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlayerCredentials;
  } catch {
    window.localStorage.removeItem(storageKey(roomToken));
    return null;
  }
}

export function clearCredentials(roomToken: string): void {
  window.localStorage.removeItem(storageKey(roomToken));
}

export async function fetchRoomState(roomToken: string, credentials: PlayerCredentials): Promise<SanitizedRoomState> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomToken)}/state`, {
    headers: {
      "x-player-id": credentials.playerId,
      "x-player-secret": credentials.playerSecret
    }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Could not load room.");
  return body.state as SanitizedRoomState;
}

export async function postRoomAction(
  roomToken: string,
  credentials: PlayerCredentials,
  action: RoomAction
): Promise<SanitizedRoomState> {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomToken)}/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-player-id": credentials.playerId,
      "x-player-secret": credentials.playerSecret
    },
    body: JSON.stringify(action)
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "Action failed.");
  return body.state as SanitizedRoomState;
}
