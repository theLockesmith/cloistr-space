/**
 * @fileoverview Social feed types
 * Nostr note events and interactions
 */

// ============================================
// Event Kinds
// ============================================

/** Short text note (kind:1) */
export const NOTE_KIND = 1;

/** Reaction (kind:7) */
export const REACTION_KIND = 7;

/** Repost (kind:6) */
export const REPOST_KIND = 6;

/** Zap receipt (kind:9735) */
export const ZAP_RECEIPT_KIND = 9735;

/** Zap request (kind:9734) */
export const ZAP_REQUEST_KIND = 9734;

// ============================================
// Core Types
// ============================================

/** Author profile info */
export interface AuthorProfile {
  name?: string;
  displayName?: string;
  picture?: string;
  nip05?: string;
  about?: string;
}

/** A kind:1 note with engagement data */
export interface Note {
  /** Event ID */
  id: string;
  /** Author pubkey */
  pubkey: string;
  /** Note content */
  content: string;
  /** Created timestamp (unix) */
  createdAt: number;
  /** Author profile */
  authorProfile?: AuthorProfile;
  /** Event being replied to (e tag) */
  replyTo?: string;
  /** Root event of thread (e tag with root marker) */
  rootEvent?: string;
  /** Mentioned pubkeys (p tags) */
  mentions: string[];
  /** Hashtags (t tags) */
  hashtags: string[];
  /** Media URLs extracted from content or tags */
  media: MediaAttachment[];
  /** Engagement counts */
  engagement: NoteEngagement;
  /** Whether current user has reacted */
  userReacted: boolean;
  /** Whether current user has reposted */
  userReposted: boolean;
  /** Whether current user has zapped */
  userZapped: boolean;
}

/** Media attachment in a note */
export interface MediaAttachment {
  url: string;
  mimeType?: string;
  thumbnail?: string;
  dimensions?: { width: number; height: number };
}

/** Engagement metrics for a note */
export interface NoteEngagement {
  /** Number of reactions */
  reactions: number;
  /** Number of replies */
  replies: number;
  /** Number of reposts */
  reposts: number;
  /** Total sats zapped */
  zapAmount: number;
  /** Number of zaps */
  zapCount: number;
}

/** A reaction event (kind:7) */
export interface Reaction {
  /** Event ID */
  id: string;
  /** Reactor pubkey */
  pubkey: string;
  /** Reaction content (+ or emoji) */
  content: string;
  /** Event being reacted to */
  eventId: string;
  /** Created timestamp */
  createdAt: number;
}

/** A repost event (kind:6) */
export interface Repost {
  /** Event ID */
  id: string;
  /** Reposter pubkey */
  pubkey: string;
  /** Original event ID */
  eventId: string;
  /** Created timestamp */
  createdAt: number;
}

/** A zap receipt (kind:9735) */
export interface ZapReceipt {
  /** Event ID */
  id: string;
  /** Zapper pubkey */
  senderPubkey: string;
  /** Recipient pubkey */
  recipientPubkey: string;
  /** Zapped event ID */
  eventId?: string;
  /** Amount in millisats */
  amount: number;
  /** Comment from zapper */
  comment?: string;
  /** Created timestamp */
  createdAt: number;
}

// ============================================
// Feed Types
// ============================================

/** Feed filter mode */
export type FeedMode = 'following' | 'wot' | 'global';

/** Feed configuration */
export interface FeedConfig {
  /** Filter mode */
  mode: FeedMode;
  /** WoT depth (for wot mode) */
  wotDepth?: number;
  /** Filter by hashtag */
  hashtag?: string;
  /** Notes per page for pagination */
  pageSize: number;
}

/** Thread of notes */
export interface NoteThread {
  /** Root note */
  root: Note;
  /** Direct replies */
  replies: Note[];
  /** Total reply count (may be more than loaded) */
  totalReplies: number;
}

// ============================================
// Action Types
// ============================================

/** Compose options */
export interface ComposeOptions {
  /** Reply to event ID */
  replyTo?: string;
  /** Quote event ID */
  quote?: string;
  /** Mentions to include */
  mentions?: string[];
  /** Media attachments */
  media?: File[];
}

/** Zap options */
export interface ZapOptions {
  /** Event to zap */
  eventId: string;
  /** Recipient pubkey */
  recipientPubkey: string;
  /** Amount in sats */
  amount: number;
  /** Optional comment */
  comment?: string;
}
