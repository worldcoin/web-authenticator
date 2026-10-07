import type { SessionRepositoryV0, StoredSessionV0 } from "./types";

export class InMemorySessionRepositoryV0 implements SessionRepositoryV0 {
  private readonly records = new Map<string, StoredSessionV0>();
  private readonly creationKeys = new Map<string, string>();

  get(sessionId: string): StoredSessionV0 | undefined {
    return this.records.get(sessionId);
  }

  put(record: StoredSessionV0): void {
    this.records.set(record.session.sessionId, record);
    this.creationKeys.set(
      `${record.rpId}\u0000${record.session.idempotencyKey}`,
      record.session.sessionId,
    );
  }

  findByCreationIdempotency(rpId: string, idempotencyKey: string): StoredSessionV0 | undefined {
    const sessionId = this.creationKeys.get(`${rpId}\u0000${idempotencyKey}`);
    return sessionId === undefined ? undefined : this.records.get(sessionId);
  }

  purgeExpired(nowMs: number): number {
    let purged = 0;
    for (const [sessionId, record] of this.records) {
      if (Date.parse(record.session.expiresAt) > nowMs) continue;
      this.records.delete(sessionId);
      this.creationKeys.delete(`${record.rpId}\u0000${record.session.idempotencyKey}`);
      purged += 1;
    }
    return purged;
  }
}
