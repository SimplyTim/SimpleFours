import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHash } from "crypto";
import { readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import type { RoomDoc } from "@/types/game";

export interface RoomStore {
  createRoom(room: RoomDoc): Promise<void>;
  getRoom(roomToken: string): Promise<RoomDoc | null>;
  updateRoom(roomToken: string, updater: (room: RoomDoc) => RoomDoc): Promise<RoomDoc>;
}

function cloneRoom(room: RoomDoc): RoomDoc {
  return structuredClone(room) as RoomDoc;
}

function isoToTimestamp(value: string): Timestamp {
  return Timestamp.fromDate(new Date(value));
}

function timestampToIso(value: unknown): string {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return new Date().toISOString();
}

function toFirestoreRoom(room: RoomDoc): Record<string, unknown> {
  return {
    ...room,
    createdAt: isoToTimestamp(room.createdAt),
    updatedAt: isoToTimestamp(room.updatedAt),
    expiresAt: isoToTimestamp(room.expiresAt)
  };
}

function fromFirestoreRoom(data: FirebaseFirestore.DocumentData): RoomDoc {
  return {
    ...(data as RoomDoc),
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
    expiresAt: timestampToIso(data.expiresAt)
  };
}

class MemoryRoomStore implements RoomStore {
  private rooms: Map<string, RoomDoc>;
  private filePath: string;

  constructor() {
    const globalRooms = globalThis as typeof globalThis & { __simpleFoursRooms?: Map<string, RoomDoc> };
    globalRooms.__simpleFoursRooms ??= new Map<string, RoomDoc>();
    this.rooms = globalRooms.__simpleFoursRooms;
    const cwdHash = createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12);
    this.filePath = join(tmpdir(), `simplefours-memory-${cwdHash}.json`);
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, RoomDoc>;
      this.rooms.clear();
      for (const [roomToken, room] of Object.entries(parsed)) {
        this.rooms.set(roomToken, room);
      }
    } catch {
      // The local fallback store starts empty when no temp file exists.
    }
  }

  private async persist(): Promise<void> {
    const data = Object.fromEntries(this.rooms.entries());
    await writeFile(this.filePath, JSON.stringify(data), "utf8");
  }

  async createRoom(room: RoomDoc): Promise<void> {
    await this.load();
    if (this.rooms.has(room.roomToken)) {
      throw new Error("Room token already exists.");
    }
    this.rooms.set(room.roomToken, cloneRoom(room));
    await this.persist();
  }

  async getRoom(roomToken: string): Promise<RoomDoc | null> {
    await this.load();
    const room = this.rooms.get(roomToken);
    if (!room) return null;
    if (Date.parse(room.expiresAt) <= Date.now()) {
      this.rooms.delete(roomToken);
      await this.persist();
      return null;
    }
    return cloneRoom(room);
  }

  async updateRoom(roomToken: string, updater: (room: RoomDoc) => RoomDoc): Promise<RoomDoc> {
    const room = await this.getRoom(roomToken);
    if (!room) throw new Error("Room not found.");
    const updated = updater(room);
    this.rooms.set(roomToken, cloneRoom(updated));
    await this.persist();
    return cloneRoom(updated);
  }
}

class FirestoreRoomStore implements RoomStore {
  private collection = getFirestore().collection("rooms");

  async createRoom(room: RoomDoc): Promise<void> {
    const ref = this.collection.doc(room.roomToken);
    await getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        throw new Error("Room token already exists.");
      }
      transaction.set(ref, toFirestoreRoom(room));
    });
  }

  async getRoom(roomToken: string): Promise<RoomDoc | null> {
    const snapshot = await this.collection.doc(roomToken).get();
    if (!snapshot.exists) return null;
    const room = fromFirestoreRoom(snapshot.data() ?? {});
    if (Date.parse(room.expiresAt) <= Date.now()) return null;
    return room;
  }

  async updateRoom(roomToken: string, updater: (room: RoomDoc) => RoomDoc): Promise<RoomDoc> {
    const ref = this.collection.doc(roomToken);
    return getFirestore().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("Room not found.");
      const current = fromFirestoreRoom(snapshot.data() ?? {});
      if (Date.parse(current.expiresAt) <= Date.now()) throw new Error("Room not found.");
      const updated = updater(current);
      transaction.set(ref, toFirestoreRoom(updated));
      return updated;
    });
  }
}

let cachedStore: RoomStore | null = null;

function firebaseAdminEnv(): { projectId?: string; clientEmail?: string; privateKey?: string } {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  return { projectId, clientEmail, privateKey };
}

function hasFirebaseAdminCredentials(): boolean {
  const { projectId, clientEmail, privateKey } = firebaseAdminEnv();
  return Boolean(
    projectId &&
      clientEmail &&
      privateKey &&
      !clientEmail.includes("example.iam.gserviceaccount.com") &&
      !privateKey.includes("...")
  );
}

function shouldUseMemoryStore(): boolean {
  return process.env.SIMPLEFOURS_STORE === "memory" || (process.env.NODE_ENV !== "production" && !hasFirebaseAdminCredentials());
}

function initializeFirebase(): void {
  if (getApps().length > 0) return;

  if (!hasFirebaseAdminCredentials()) {
    throw new Error(
      "Firebase Admin credentials are missing. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY, or use SIMPLEFOURS_STORE=memory for local development."
    );
  }

  const { projectId, clientEmail, privateKey } = firebaseAdminEnv();
  initializeApp({
    credential: cert({
      projectId: projectId!,
      clientEmail: clientEmail!,
      privateKey: privateKey!
    })
  });
}

export function getRoomStore(): RoomStore {
  if (cachedStore) return cachedStore;
  if (shouldUseMemoryStore()) {
    cachedStore = new MemoryRoomStore();
    return cachedStore;
  }

  initializeFirebase();
  cachedStore = new FirestoreRoomStore();
  return cachedStore;
}
