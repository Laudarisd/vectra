// Beginner guide: Handles l oc al ch at hi st or y responsibilities for Vectra.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChatMessage } from '../types';

export interface SavedChat {
  id: string;
  title: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export class LocalChatHistory {
  constructor(readonly directory = process.env.VECTRA_HISTORY_DIR || path.join(os.homedir(), '.agent', 'vectra', 'history')) {}

  list(): Array<Omit<SavedChat, 'messages'> & { messageCount: number }> {
    return this.readAll().map(({ messages, ...chat }) => ({ ...chat, messageCount: messages.length }));
  }

  get(id: string): SavedChat | undefined { return this.read(id); }

  save(messages: ChatMessage[], provider: string, model: string, id: string = randomUUID()): SavedChat {
    const previous = this.read(id);
    const now = Date.now();
    const chat: SavedChat = {
      id,
      title: titleFrom(messages),
      provider,
      model,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      messages: messages.slice(-300)
    };
    mkdirSync(this.directory, { recursive: true });
    const target = this.file(id);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(chat), 'utf8');
    renameSync(temporary, target);
    return chat;
  }

  delete(id: string): void { rmSync(this.file(id), { force: true }); }

  private readAll(): SavedChat[] {
    try {
      return readdirSync(this.directory)
        .filter((name) => /^[a-zA-Z0-9-]{8,80}\.json$/.test(name))
        .flatMap((name) => { const chat = this.read(name.slice(0, -5)); return chat ? [chat] : []; })
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 500);
    } catch { return []; }
  }

  private read(id: string): SavedChat | undefined {
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(id)) return undefined;
    try {
      const chat = JSON.parse(readFileSync(this.file(id), 'utf8')) as SavedChat;
      chat.messages = (chat.messages || []).map((message) => ({
        ...message,
        id: message.id || randomUUID(),
        mode: message.mode || 'ask'
      }));
      return chat;
    }
    catch { return undefined; }
  }

  private file(id: string): string { return path.join(this.directory, `${id}.json`); }
}

function titleFrom(messages: ChatMessage[]): string {
  const text = messages.find((message) => message.role === 'user')?.content || 'New chat';
  return text.replace(/\s+/g, ' ').trim().slice(0, 80) || 'New chat';
}
