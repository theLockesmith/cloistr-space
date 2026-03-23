import { create } from 'zustand';
import type { WorkspaceView, ServiceStatus } from '@/types/workspace';

interface WorkspaceState {
  currentView: WorkspaceView;
  sidebarOpen: boolean;
  services: Map<string, ServiceStatus>;
  notifications: Notification[];

  // Actions
  setView: (view: WorkspaceView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  updateServiceStatus: (name: string, status: Partial<ServiceStatus>) => void;
  addNotification: (notification: Notification) => void;
  dismissNotification: (id: string) => void;
}

interface Notification {
  id: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  createdAt: Date;
  read: boolean;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  currentView: 'activity',
  sidebarOpen: true,
  services: new Map([
    ['relay', { name: 'Relay', url: 'wss://relay.cloistr.xyz', isConnected: false }],
    ['drive', { name: 'Drive', url: 'https://drive-api.cloistr.xyz', isConnected: false }],
    ['blossom', { name: 'Blossom', url: 'https://files.cloistr.xyz', isConnected: false }],
    ['signer', { name: 'Signer', url: 'https://signer.cloistr.xyz', isConnected: false }],
  ]),
  notifications: [],

  setView: (currentView) => set({ currentView }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  updateServiceStatus: (name, status) =>
    set((state) => {
      const services = new Map(state.services);
      const existing = services.get(name);
      if (existing) {
        services.set(name, { ...existing, ...status });
      }
      return { services };
    }),

  addNotification: (notification) =>
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 50),
    })),

  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
