export type WorkspaceView = 'activity' | 'projects' | 'social';

export interface ActivityData {
  recentFiles: DriveFile[];
  tasks: Task[];
  mentions: Mention[];
  calendarEvents: CalendarEvent[];
  collaborations: ActiveCollaboration[];
}

export interface DriveFile {
  id: string;
  name: string;
  type: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  modifiedAt: Date;
  sharedWith: string[];
  groupId?: string;
  encrypted: boolean;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  dueDate?: Date;
  priority: 'low' | 'medium' | 'high';
  createdAt: Date;
}

export interface Mention {
  id: string;
  eventId: string;
  authorPubkey: string;
  content: string;
  createdAt: Date;
  read: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: Date;
  endTime?: Date;
  allDay: boolean;
  location?: string;
}

export interface ActiveCollaboration {
  documentId: string;
  documentName: string;
  participants: string[];
  lastActivity: Date;
}

export interface ServiceStatus {
  name: string;
  url: string;
  isConnected: boolean;
  lastPing?: Date;
}
