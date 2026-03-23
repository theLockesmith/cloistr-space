/**
 * @fileoverview Activity dashboard types
 * Covers files, tasks, calendar events, and mentions
 */

// ============================================
// File Metadata (Kind 1063 - NIP-94)
// ============================================

export interface FileMetadata {
  /** Event ID */
  id: string;
  /** Author pubkey */
  pubkey: string;
  /** File name */
  name: string;
  /** File URL (from url tag or Blossom) */
  url: string;
  /** MIME type */
  mimeType: string;
  /** File size in bytes */
  size?: number;
  /** SHA-256 hash (x tag) */
  hash?: string;
  /** Thumbnail URL */
  thumbnail?: string;
  /** Dimensions for images/video */
  dimensions?: { width: number; height: number };
  /** Blurhash for placeholder */
  blurhash?: string;
  /** Associated group (h tag) */
  groupId?: string;
  /** Created timestamp */
  createdAt: number;
}

export type FileType = 'document' | 'spreadsheet' | 'image' | 'video' | 'audio' | 'archive' | 'other';

export function getFileType(mimeType: string): FileType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel') || mimeType === 'text/csv') return 'spreadsheet';
  if (mimeType.includes('document') || mimeType.includes('word') || mimeType === 'text/markdown' || mimeType === 'text/plain') return 'document';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed')) return 'archive';
  return 'other';
}

// ============================================
// Tasks (Kind 31990 - Addressable)
// ============================================

export interface Task {
  /** Event ID */
  id: string;
  /** Author pubkey */
  pubkey: string;
  /** d-tag identifier */
  identifier: string;
  /** Task title */
  title: string;
  /** Task description */
  description?: string;
  /** Completion status */
  completed: boolean;
  /** Priority level */
  priority: 'low' | 'medium' | 'high';
  /** Due date (unix timestamp) */
  dueDate?: number;
  /** Associated project/group (h tag) */
  groupId?: string;
  /** Labels/tags */
  labels: string[];
  /** Created timestamp */
  createdAt: number;
  /** Last updated timestamp */
  updatedAt: number;
}

export const TASK_KIND = 31990;

// ============================================
// Calendar Events (NIP-52 - Kind 31922/31923)
// ============================================

export interface CalendarEvent {
  /** Event ID */
  id: string;
  /** Author pubkey */
  pubkey: string;
  /** d-tag identifier */
  identifier: string;
  /** Event title */
  title: string;
  /** Event description */
  description?: string;
  /** Start time (unix timestamp) */
  startTime: number;
  /** End time (unix timestamp) */
  endTime?: number;
  /** All-day event */
  allDay: boolean;
  /** Location */
  location?: string;
  /** Associated group (h tag) */
  groupId?: string;
  /** Participants (p tags) */
  participants: string[];
  /** Created timestamp */
  createdAt: number;
}

/** Date-based calendar event */
export const CALENDAR_DATE_KIND = 31922;
/** Time-based calendar event */
export const CALENDAR_TIME_KIND = 31923;

// ============================================
// Mentions (Kind 1 notes with p-tag to user)
// ============================================

export interface Mention {
  /** Event ID */
  id: string;
  /** Author pubkey */
  pubkey: string;
  /** Note content */
  content: string;
  /** Author profile (cached) */
  authorProfile?: {
    name?: string;
    displayName?: string;
    picture?: string;
    nip05?: string;
  };
  /** Event being replied to */
  replyTo?: string;
  /** Root event of thread */
  rootEvent?: string;
  /** Created timestamp */
  createdAt: number;
  /** Whether user has read this mention */
  read: boolean;
}

// ============================================
// Widget State Types
// ============================================

export interface WidgetState<T> {
  items: T[];
  isLoading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

export interface PaginatedWidgetState<T> extends WidgetState<T> {
  hasMore: boolean;
  loadMore: () => void;
}
