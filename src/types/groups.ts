/**
 * @fileoverview NIP-29 Group types
 * Relay-based groups with membership and moderation
 */

/** NIP-29 Event Kinds */
export const GROUP_CHAT_KIND = 9;
export const GROUP_METADATA_KIND = 39000;
export const GROUP_ADMINS_KIND = 39001;
export const GROUP_MEMBERS_KIND = 39002;
export const GROUP_MOD_ACTION_KIND = 9000;
export const GROUP_JOIN_REQUEST_KIND = 9021;
export const GROUP_LEAVE_REQUEST_KIND = 9022;

/** Group metadata from kind:39000 */
export interface Group {
  id: string;
  pubkey: string;
  /** Group identifier (d-tag) */
  identifier: string;
  /** Display name */
  name: string;
  /** Group description */
  description?: string;
  /** Group picture URL */
  picture?: string;
  /** Whether group is public or private */
  isPublic: boolean;
  /** Whether group is open (anyone can join) or closed (requires approval) */
  isOpen: boolean;
  /** Relay URL where group is hosted */
  relay: string;
  /** Creation timestamp */
  createdAt: number;
}

/** Group member from kind:39002 */
export interface GroupMember {
  pubkey: string;
  /** Optional display name */
  name?: string;
  /** Optional profile picture */
  picture?: string;
  /** When they joined */
  joinedAt?: number;
}

/** Group admin from kind:39001 */
export interface GroupAdmin extends GroupMember {
  /** Admin permissions */
  permissions: AdminPermission[];
}

/** Admin permission types */
export type AdminPermission =
  | 'add-user'
  | 'remove-user'
  | 'edit-metadata'
  | 'delete-event'
  | 'add-permission'
  | 'remove-permission';

/** Group chat message from kind:9 */
export interface GroupMessage {
  id: string;
  pubkey: string;
  groupId: string;
  content: string;
  /** Reply to another message */
  replyTo?: string;
  /** Mentioned pubkeys */
  mentions: string[];
  createdAt: number;
  /** Author profile (fetched separately) */
  authorProfile?: {
    name?: string;
    displayName?: string;
    picture?: string;
  };
}

/** Join request from kind:9021 */
export interface JoinRequest {
  id: string;
  pubkey: string;
  groupId: string;
  /** Optional message with request */
  message?: string;
  createdAt: number;
  /** Request status */
  status: 'pending' | 'approved' | 'rejected';
}

/** User's relationship to a group */
export interface GroupMembership {
  group: Group;
  /** Whether user is a member */
  isMember: boolean;
  /** Whether user is an admin */
  isAdmin: boolean;
  /** User's admin permissions (if admin) */
  permissions: AdminPermission[];
  /** Pending join request (if any) */
  pendingRequest?: JoinRequest;
}

/** Group list filter options */
export interface GroupFilter {
  /** Only groups user is member of */
  memberOnly?: boolean;
  /** Only groups user is admin of */
  adminOnly?: boolean;
  /** Search by name */
  search?: string;
}
