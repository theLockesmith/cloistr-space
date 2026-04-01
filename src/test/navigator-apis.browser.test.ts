/**
 * @fileoverview Browser tests for Navigator APIs
 */

import { describe, it, expect } from 'vitest';

describe('Navigator APIs (Browser)', () => {
  describe('Basic Navigator properties', () => {
    it('should have navigator object', () => {
      expect(navigator).toBeDefined();
    });

    it('should have userAgent', () => {
      expect(navigator.userAgent).toBeDefined();
      expect(typeof navigator.userAgent).toBe('string');
      expect(navigator.userAgent.length).toBeGreaterThan(0);
    });

    it('should have language info', () => {
      expect(navigator.language).toBeDefined();
      expect(typeof navigator.language).toBe('string');
    });

    it('should have online status', () => {
      expect(typeof navigator.onLine).toBe('boolean');
    });
  });

  describe('Clipboard API availability', () => {
    it('should have clipboard API in secure context', () => {
      // In a real browser with HTTPS, clipboard should be available
      // Note: This might not be available in headless browser testing
      expect(navigator.clipboard).toBeDefined();
    });

    // Note: We can't actually test clipboard functionality in headless browser
    // because it requires user interaction and secure context
  });

  describe('Media capabilities', () => {
    it('should have mediaDevices API', () => {
      expect(navigator.mediaDevices).toBeDefined();
    });

    it('should have getUserMedia capability', () => {
      expect(navigator.mediaDevices.getUserMedia).toBeDefined();
      expect(typeof navigator.mediaDevices.getUserMedia).toBe('function');
    });

    // Note: We can't actually call getUserMedia in tests as it requires user permission
  });

  describe('Service Worker support', () => {
    it('should have serviceWorker API', () => {
      expect(navigator.serviceWorker).toBeDefined();
    });

    it('should have register method', () => {
      expect(navigator.serviceWorker.register).toBeDefined();
      expect(typeof navigator.serviceWorker.register).toBe('function');
    });
  });

  describe('Storage APIs', () => {
    it('should have storage API', () => {
      expect(navigator.storage).toBeDefined();
    });

    it('should be able to estimate storage', async () => {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        expect(estimate).toBeDefined();
        expect(typeof estimate.usage === 'undefined' || typeof estimate.usage === 'number').toBe(true);
        expect(typeof estimate.quota === 'undefined' || typeof estimate.quota === 'number').toBe(true);
      }
    });
  });

  describe('Permissions API', () => {
    it('should have permissions API', () => {
      expect(navigator.permissions).toBeDefined();
    });

    it('should have query method', () => {
      expect(navigator.permissions.query).toBeDefined();
      expect(typeof navigator.permissions.query).toBe('function');
    });
  });
});