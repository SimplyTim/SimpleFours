"use client";

import { DoorOpen, Plus, Spade, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";
import { saveCredentials } from "@/lib/client-room";

export default function HomePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [roomToken, setRoomToken] = useState("");
  const [joinModalOpen, setJoinModalOpen] = useState(false);
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const roomCodeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!joinModalOpen) return;
    roomCodeInputRef.current?.focus();
  }, [joinModalOpen]);

  async function createRoom() {
    setBusy("create");
    setError("");
    try {
      const body = await postJsonWithRetry("/api/rooms", { name: name || "Host" });
      saveCredentials(body.roomToken, {
        playerId: body.playerId,
        playerSecret: body.playerSecret
      });
      router.push(`/room/${body.roomToken}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create room.");
    } finally {
      setBusy(null);
    }
  }

  async function joinRoom(event?: FormEvent) {
    event?.preventDefault();

    setBusy("join");
    setError("");
    try {
      const token = roomToken.trim().toUpperCase();
      const response = await fetch(`/api/rooms/${encodeURIComponent(token)}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not join room.");
      saveCredentials(token, {
        playerId: body.playerId,
        playerSecret: body.playerSecret
      });
      setJoinModalOpen(false);
      router.push(`/room/${token}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not join room.");
    } finally {
      setBusy(null);
    }
  }

  function openJoinModal() {
    setJoinModalOpen(true);
    setError("");
  }

  function closeJoinModal() {
    if (busy !== null) return;
    setJoinModalOpen(false);
    setError("");
  }

  return (
    <main className="home-shell">
      <section className="home-table" aria-label="SimpleFours table">
        <div className="home-topbar">
          <div className="brand-mark">
            <Spade size={24} />
            <span>SimpleFours</span>
          </div>
          <ThemeToggle />
        </div>

        <div className="panel compact-panel home-card">
          <h1>Play with friends</h1>
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} placeholder="Player name" />
          </label>
          <div className="home-actions">
            <button type="button" className="primary-button" disabled={busy !== null} onClick={createRoom}>
              <Plus size={18} />
              {busy === "create" ? "Creating" : "Create room"}
            </button>
            <button type="button" className="secondary-button" disabled={busy !== null} onClick={openJoinModal}>
              <DoorOpen size={18} />
              Join room
            </button>
          </div>
        </div>

        {joinModalOpen ? (
          <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && closeJoinModal()}>
            <form className="panel join-room-modal" role="dialog" aria-modal="true" aria-labelledby="join-room-title" onSubmit={joinRoom}>
              <div className="modal-title-row">
                <h2 id="join-room-title">Join room</h2>
                <button type="button" className="icon-button" onClick={closeJoinModal} aria-label="Close join room dialog" title="Close">
                  <X size={17} />
                </button>
              </div>
              <label>
                Room code
                <input
                  ref={roomCodeInputRef}
                  value={roomToken}
                  onChange={(event) => setRoomToken(event.target.value.toUpperCase())}
                  maxLength={10}
                  placeholder="ABCD234"
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="secondary-button" disabled={busy !== null} onClick={closeJoinModal}>
                  Cancel
                </button>
                <button className="primary-button" disabled={busy !== null}>
                  <DoorOpen size={18} />
                  {busy === "join" ? "Joining" : "Join room"}
                </button>
              </div>
              {error ? <p className="error-line">{error}</p> : null}
            </form>
          </div>
        ) : null}

        {error && !joinModalOpen ? <p className="error-line">{error}</p> : null}
      </section>
    </main>
  );
}

async function postJsonWithRetry(url: string, body: Record<string, unknown>) {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      const payload = text ? JSON.parse(text) : {};
      if (response.ok) return payload;
      lastError = new Error(payload.error ?? "Could not create room.");
    } catch (caught) {
      lastError = caught instanceof Error ? caught : new Error("Could not create room.");
    }

    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  throw lastError ?? new Error("Could not create room.");
}
