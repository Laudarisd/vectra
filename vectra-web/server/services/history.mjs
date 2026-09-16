// Beginner guide: Handles h is to ry responsibilities for Vectra.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

// Chat history is deliberately local-only. Credentials are never accepted by
// this store, and the database lives in the user's application-data directory.
export class ChatHistoryStore {
  constructor(databasePath = defaultDatabasePath(), sharedDirectory = defaultSharedHistoryDirectory(databasePath)) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.sharedDirectory = sharedDirectory;
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
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
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
      CREATE TABLE IF NOT EXISTS attachments (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        name TEXT NOT NULL,
        mime TEXT NOT NULL,
        kind TEXT NOT NULL,
        size INTEGER NOT NULL,
        text_content TEXT NOT NULL DEFAULT '',
        base64 TEXT NOT NULL DEFAULT '',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY(conversation_id, position)
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, position);
    `);
    if(!this.db.prepare('PRAGMA table_info(conversations)').all().some(column=>column.name==='project_id'))this.db.exec('ALTER TABLE conversations ADD COLUMN project_id TEXT');
    this.upsertConversation = this.db.prepare(`
      INSERT INTO conversations (id, title, provider, model, created_at, updated_at, project_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        provider = excluded.provider,
        model = excluded.model,
        updated_at = excluded.updated_at,
        project_id = excluded.project_id
    `);
    this.deleteMessages = this.db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    this.deleteAttachments = this.db.prepare('DELETE FROM attachments WHERE conversation_id = ?');
    this.insertMessage = this.db.prepare(`
      INSERT INTO messages (conversation_id, position, role, content, artifacts_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.insertAttachment=this.db.prepare('INSERT INTO attachments (conversation_id,position,name,mime,kind,size,text_content,base64,metadata_json) VALUES (?,?,?,?,?,?,?,?,?)');
  }

  list(limit = 100) {
    const databaseChats = this.db.prepare(`
      SELECT c.id, c.title, c.provider, c.model, c.project_id AS projectId, c.created_at AS createdAt,
             c.updated_at AS updatedAt, COUNT(m.id) AS messageCount
      FROM conversations c
      LEFT JOIN messages m ON m.conversation_id = c.id
      GROUP BY c.id
      ORDER BY c.updated_at DESC
      LIMIT ?
    `).all(Math.max(1, Math.min(500, Number(limit) || 100)));
    const merged = new Map(listSharedChats(this.sharedDirectory).map((chat) => [chat.id, chat]));
    for (const chat of databaseChats) {
      const shared = merged.get(chat.id);
      if (!shared || chat.updatedAt >= shared.updatedAt) merged.set(chat.id, chat);
    }
    return [...merged.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  }

  get(id) {
    const conversation = this.db.prepare(`
      SELECT id, title, provider, model, project_id AS projectId, created_at AS createdAt, updated_at AS updatedAt
      FROM conversations WHERE id = ?
    `).get(id);
    const shared = readSharedChat(this.sharedDirectory, id);
    if (!conversation) return shared;
    if (shared && shared.updatedAt > conversation.updatedAt) return shared;
    const rows = this.db.prepare(`
      SELECT role, content, artifacts_json AS artifactsJson, created_at AS createdAt
      FROM messages WHERE conversation_id = ? ORDER BY position
    `).all(id);
    const attachments=this.db.prepare('SELECT name,mime,kind,size,text_content AS text,base64,metadata_json AS metadataJson FROM attachments WHERE conversation_id=? ORDER BY position').all(id).map(row=>({...row,...safeJsonObject(row.metadataJson),metadataJson:undefined}));
    const saved = {
      ...conversation,
      attachments,
      messages: rows.map((row) => ({
        role: row.role,
        content: row.content,
        artifacts: safeJsonArray(row.artifactsJson),
        createdAt: row.createdAt
      }))
    };
    return saved;
  }

  save(input = {}) {
    const now = Date.now();
    const id = validId(input.id) ? input.id : randomUUID();
    const existing = this.db.prepare('SELECT created_at AS createdAt FROM conversations WHERE id = ?').get(id);
    const messages = sanitizeMessages(input.messages);
    const attachments=sanitizeAttachments(input.attachments);
    const title = cleanTitle(input.title || deriveTitle(messages));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.upsertConversation.run(id, title, cleanField(input.provider, 80), cleanField(input.model, 240), existing?.createdAt || now, now, validId(input.projectId)?input.projectId:null);
      this.deleteMessages.run(id);
      this.deleteAttachments.run(id);
      messages.forEach((message, position) => {
        this.insertMessage.run(id, position, message.role, message.content, JSON.stringify(message.artifacts), message.createdAt || now);
      });
      attachments.forEach((file,position)=>this.insertAttachment.run(id,position,file.name,file.mime,file.kind,file.size,file.text,file.base64,JSON.stringify(file.metadata)));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    const saved = this.get(id);
    if (saved) writeSharedChat(this.sharedDirectory, saved);
    return saved;
  }

  delete(id) {
    const databaseDeleted = this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id).changes > 0;
    const sharedDeleted = deleteSharedChat(this.sharedDirectory, id);
    return databaseDeleted || sharedDeleted;
  }

  deleteMany(ids) { return [...new Set(ids)].reduce((count,id)=>count+(validId(id)&&this.delete(id)?1:0),0); }
  deleteAll() { return this.deleteMany(this.list(500).map(chat=>chat.id)); }

  listProjects() {
    return this.db.prepare(`SELECT p.id,p.name,p.created_at AS createdAt,p.updated_at AS updatedAt,COUNT(c.id) AS chatCount FROM projects p LEFT JOIN conversations c ON c.project_id=p.id GROUP BY p.id ORDER BY p.updated_at DESC`).all();
  }
  createProject(name) {
    const id=randomUUID(),now=Date.now();
    this.db.prepare('INSERT INTO projects (id,name,created_at,updated_at) VALUES (?,?,?,?)').run(id,cleanTitle(name),now,now);
    return{id,name:cleanTitle(name),createdAt:now,updatedAt:now,chatCount:0};
  }
  deleteProject(id) {
    if(!validId(id))return false;
    this.deleteMany(this.db.prepare('SELECT id FROM conversations WHERE project_id=?').all(id).map(row=>row.id));
    return this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes>0;
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

export function defaultSharedHistoryDirectory(databasePath = defaultDatabasePath()) {
  if (process.env.VECTRA_HISTORY_DIR) return process.env.VECTRA_HISTORY_DIR;
  if (process.env.VECTRA_DATABASE_PATH || databasePath !== defaultDatabasePath()) return join(dirname(databasePath), 'history');
  return join(homedir(), '.agent', 'vectra', 'history');
}

function listSharedChats(directory) {
  try {
    return readdirSync(directory)
      .filter((name) => /^[a-zA-Z0-9-]{8,80}\.json$/.test(name))
      .flatMap((name) => { const chat = readSharedChat(directory, name.slice(0, -5)); return chat ? [{ ...chat, messageCount: chat.messages.length, messages: undefined }] : []; })
      .map(({ messages: _messages, ...chat }) => chat);
  } catch { return []; }
}

function readSharedChat(directory, id) {
  if (!validId(id)) return undefined;
  try { return JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')); }
  catch { return undefined; }
}

function writeSharedChat(directory, chat) {
  mkdirSync(directory, { recursive: true });
  const target = join(directory, `${chat.id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(chat), 'utf8');
  renameSync(temporary, target);
}

function deleteSharedChat(directory, id) {
  if (!validId(id)) return false;
  try { rmSync(join(directory, `${id}.json`)); return true; }
  catch { return false; }
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
    base64: String(artifact?.base64 || '').slice(0, 64_000_000),
    previewText: String(artifact?.previewText || '').slice(0, 4_000_000),
    ...(['image','chart'].includes(artifact?.view)?{view:artifact.view}:{}),
    ...(artifact?.title?{title:cleanField(artifact.title,240)}:{}),
    ...(Array.isArray(artifact?.boxes)?{boxes:artifact.boxes.slice(0,200)}:{})
  }));
}

function sanitizeAttachments(value){
  if(!Array.isArray(value))return[];
  return value.slice(0,48).map(file=>({
    name:cleanField(file?.name||'attachment',240),mime:cleanField(file?.mime||'application/octet-stream',160),kind:cleanField(file?.kind||'binary',24),size:Math.max(0,Number(file?.size)||0),
    text:String(file?.text||'').slice(0,8_000_000),base64:String(file?.base64||file?.viewBase64||'').slice(0,90_000_000),
    metadata:Object.fromEntries(['width','height','sourceWidth','sourceHeight','pageNumber','pageClassification','ocrRequired'].flatMap(key=>file?.[key]!==undefined?[[key,file[key]]]:[]))
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
function safeJsonObject(value) { try { const parsed=JSON.parse(value); return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{}; } catch { return {}; } }
