// NIP-29 Group Types

export interface Nip29Group {
  id: string;
  relayUrl: string;
  name: string;
  picture?: string;
  about?: string;
  isPublic: boolean;
  isOpen: boolean;
  members: GroupMember[];
  admins: string[];
  createdAt: Date;
  rules?: string;
}

export interface GroupMember {
  pubkey: string;
  joinedAt: Date;
  roles: GroupRole[];
  name?: string;
  picture?: string;
}

export type GroupRole = 'admin' | 'moderator' | 'member';

export interface GroupMessage {
  id: string;
  groupId: string;
  authorPubkey: string;
  content: string;
  createdAt: Date;
  replyTo?: string;
}

export interface GroupFile {
  id: string;
  groupId: string;
  fileId: string;
  name: string;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface GroupInvite {
  code: string;
  groupId: string;
  createdBy: string;
  expiresAt?: Date;
  maxUses?: number;
  uses: number;
}
