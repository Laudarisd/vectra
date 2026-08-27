import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Chat history is deliberately local-only. Credentials are never accepted by
// this store, and the database lives in the user's application-data directory.
export class ChatHistoryStore {
  constructor(databasePath = defaultDatabasePath()) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        artifacts_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        UNIQUE(conversation_id, position)
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, position);
    `);
    this.upsertConversation = this.db.prepare(`
      INSERT INTO conversations (id, title, provider, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        provider = excluded.provider,
        model = excluded.model,
        updated_at = excluded.updated_at
    `);
    this.deleteMessages = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    this.insertMessage = this.db.prepare(`
      INSERT INTO messages (conversation_id, position, role, content, artifacts_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  list(limit = 100) {
    return this.db.prepare(`
      SELECT c.id, c.title, c.provider, c.model, c.created_at AS createdAt,
             c.updated_at AS updatedAt, COUNT(m.id) AS messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  get(id) {
    const conversation = this.db.prepare(`
      SELECT id, title, provider, model, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations WHERE id = ?
    `).get(id);
    if (!conversation) return undefined;
    const rows = this.db.prepare(`
      SELECT role, content, artifacts_json AS artifactsJson, created_at AS createdAt
      FROM messages WHERE conversation_id = ? ORDER BY position
    `).all(id);
    return {
      ...conversation,
      messages: rows.map((row) => ({
        role: row.role,
        content: row.content,
        artifacts: safeJsonArray(row.artifactsJson),
        createdAt: row.createdAt
      }))
    };
  }

  save(input = {}) {
    const now = Date.now();
    const id = validId(input.id) ? input.id : randomUUID();
    const existing = this.db.prepare('SELECT created_at AS createdAt FROM conversations WHERE id = ?').get(id);
    const messages = sanitizeMessages(input.messages);
    const title = cleanTitle(input.title || deriveTitle(messages));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.upsertConversation.run(id, title, cleanField(input.provider, 80), cleanField(input.model, 240), existing?.createdAt || now, now);
      this.deleteMessages.run(id);
      messages.forEach((message, position) => {
        this.insertMessage.run(id, position, message.role, message.content, JSON.stringify(message.artifacts), message.createdAt || now);
      });
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return this.get(id);
  }

  delete(id) {
    return this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
  }

  close() { this.db.close(); }
}

export function defaultDatabasePath() {
  if (process.env.VECTRA_DATABASE_PATH) return process.env.VECTRA_DATABASE_PATH;
  const base = process.env.VECTRA_DATA_DIR
    || (process.platform === 'win32' ? process.env.LOCALAPPDATA : '')
    || (process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support') : join(homedir(), '.local', 'share'));
  return join(base, 'Vectra Web', 'vectra.sqlite');
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 500).map((message) => ({
    role: message?.role === 'assistant' ? 'assistant' : 'user',
    content: String(message?.content || '').slice(0, 4_000_000),
    artifacts: sanitizeArtifacts(message?.artifacts),
    createdAt: Number(message?.createdAt) || Date.now()
  }));
}

function sanitizeArtifacts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((artifact) => ({
    name: cleanField(artifact?.name || 'download', 240),
    mime: cleanField(artifact?.mime || 'application/octet-stream', 160),
    base64: String(artifact?.base64 || '').slice(0, 64_000_000)
  }));
}

function deriveTitle(messages) {
  return messages.find((message) => message.role === 'user')?.content || 'New chat';
}
function cleanTitle(value) {
  const title = String(value || 'New chat').replace(/\s+/g, ' ').trim();
  return (title || 'New chat').slice(0, 80);
}
function cleanField(value, length) { return String(value || '').trim().slice(0, length); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value); }
function safeJsonArray(value) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
