/**
 * @fileoverview The user's open Tasks cards, from the Tasks app's API.
 *
 * Tasks is not a Nostr-event app: cards live in the cloistr-tasks backend.
 * The widget used to read kind:31990 events (which is NIP-89 handler info,
 * not tasks), so it could never show a card (operator's account, 2026-10-16:
 * 0 on any relay).
 *
 * Contract (cloistr-tasks, 2026-10-16):
 *   GET https://tasks.cloistr.xyz/api/cards?assignee=me
 *   Authorization: Nostr <base64 NIP-98 kind:27235 event>, u = that exact URL,
 *   method GET. A repeated event id is rejected, and ids are deterministic,
 *   so every signing carries a random nonce tag. Every rejection is 401.
 *   Response: [{ id, title, list_id, board_name, column_name, due_date, url }],
 *   open cards only; due_date is 'YYYY-MM-DD' or null; url is '/card/<id>'.
 */

import type { SignerInterface } from '@/services/headless';
import { config } from '@/config/environment';

export interface TaskCard {
  id: string;
  title: string;
  boardName: string;
  columnName: string;
  /** 'YYYY-MM-DD' or null. */
  dueDate: string | null;
  /** Absolute link to the card in the Tasks app. */
  href: string;
}

const NIP98_KIND = 27235;

export function assignedCardsUrl(): string {
  return `${config.tasksUrl.replace(/\/$/, '')}/api/cards?assignee=me`;
}

function randomNonce(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The signer refused, or failed, to sign the request. */
export class TasksNotSigned extends Error {
  constructor(cause: unknown) {
    super(
      'Space needs your approval to read your tasks, and did not get it' +
        (cause instanceof Error && cause.message ? ` (${cause.message})` : '') +
        '.'
    );
    this.name = 'TasksNotSigned';
  }
}

export async function nip98Header(signer: SignerInterface, url: string, method: string): Promise<string> {
  let event;
  try {
    event = await signer.signEvent({
      kind: NIP98_KIND,
      pubkey: await signer.getPublicKey(),
      created_at: Math.floor(Date.now() / 1000),
      content: '',
      tags: [
        ['u', url],
        ['method', method],
        ['nonce', randomNonce()],
      ],
    });
  } catch (err) {
    throw new TasksNotSigned(err);
  }
  return `Nostr ${btoa(JSON.stringify(event))}`;
}

interface CardJson {
  id?: unknown;
  title?: unknown;
  board_name?: unknown;
  column_name?: unknown;
  due_date?: unknown;
  url?: unknown;
}

/** Due soonest first; cards with no due date after every dated one. */
export function sortByDue(cards: TaskCard[]): TaskCard[] {
  return [...cards].sort((a, b) => {
    if (a.dueDate === b.dueDate) return a.title.localeCompare(b.title);
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  });
}

export async function fetchAssignedCards(signer: SignerInterface): Promise<TaskCard[]> {
  const url = assignedCardsUrl();
  const response = await fetch(url, { headers: { Authorization: await nip98Header(signer, url, 'GET') } });
  if (response.status === 401) throw new Error('The Tasks app did not accept your sign-in (401).');
  if (!response.ok) throw new Error(`The Tasks app could not list your cards (${response.status}).`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error('The Tasks app sent an answer Space could not read.');
  const base = config.tasksUrl.replace(/\/$/, '');
  return sortByDue(
    (body as CardJson[])
      .filter((c) => (typeof c.id === 'string' || typeof c.id === 'number') && typeof c.title === 'string')
      .map((c) => ({
        id: String(c.id),
        title: c.title as string,
        boardName: typeof c.board_name === 'string' ? c.board_name : '',
        columnName: typeof c.column_name === 'string' ? c.column_name : '',
        dueDate: typeof c.due_date === 'string' ? c.due_date : null,
        href: `${base}${typeof c.url === 'string' ? c.url : `/card/${String(c.id)}`}`,
      }))
  );
}
