import { create } from 'zustand';
import type { WorkspaceView, ServiceStatus } from '@/types/workspace';

interface WorkspaceState {
  currentView: WorkspaceView;
  /** Desktop rail: expanded (w-64) vs collapsed (w-16). Always visible at md+. */
  sidebarOpen: boolean;
  /**
   * Mobile drawer: shown vs off-canvas. SEPARATE from sidebarOpen on purpose.
   *
   * One boolean cannot serve both: on desktop the sensible default is "expanded"
   * (true), but on a phone that same default renders a 256px rail over a 375px
   * viewport — 68% of the screen, which is what the responsive audit caught.
   * The drawer therefore starts CLOSED and only opens when the user asks.
   */
  mobileNavOpen: boolean;
  services: Map<string, ServiceStatus>;
  notifications: Notification[];

  // Actions
  setView: (view: WorkspaceView) => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleMobileNav: () => void;
  setMobileNavOpen: (open: boolean) => void;
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
  mobileNavOpen: false,
  services: new Map([
    ['relay', { name: 'Relay', url: 'wss://relay.cloistr.xyz', isConnected: false }],
    // drive-api.cloistr.xyz does not exist -- it is NXDOMAIN, so this could
    // never have connected. The Drive/Stash service is served at
    // stash.cloistr.xyz (the cloistr-drive deployment), whose /health answers 200.
    ['drive', { name: 'Drive', url: 'https://stash.cloistr.xyz', isConnected: false }],
    ['blossom', { name: 'Blossom', url: 'https://files.cloistr.xyz', isConnected: false }],
    ['signer', { name: 'Signer', url: 'https://signer.cloistr.xyz', isConnected: false }],
  ]),
  notifications: [],

  setView: (currentView) => set({ currentView }),

  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  toggleMobileNav: () => set((state) => ({ mobileNavOpen: !state.mobileNavOpen })),

  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),

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
