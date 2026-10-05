import { describe, it, expect } from 'vitest';
import type { Event, UnsignedEvent } from 'nostr-tools';
import type { SignerInterface, RelayClient } from '../headless';
import { DELETE_KIND, NOTE_KIND, REACTION_KIND, REPOST_KIND } from '@/types/social';
import {
  reactToNote,
  replyToNote,
  retractEvent,
  repostNote,
  postNote,
} from './noteService';

const ME = 'aa'.repeat(32);
const THEM = 'dd'.repeat(32);
const NOTE = 'ee'.repeat(32);

function mockSigner(): SignerInterface {
  return {
    getPublicKey: async () => ME,
    signEvent: async (unsigned: UnsignedEvent): Promise<Event> => ({
      ...unsigned,
      id: 'bb'.repeat(32),
      sig: 'cc'.repeat(64),
    }),
    encrypt: async () => '',
    decrypt: async () => '',
  };
}

function mockRelay(accepts = 3): RelayClient & { published: Event[] } {
  const published: Event[] = [];
  return {
    published,
    publish: async (event: Event) => {
      published.push(event);
      return accepts;
    },
    fetch: async () => [],
  };
}

describe('noteService', () => {
  describe('reactToNote', () => {
    it('publishes a kind:7 tagging the note and its author', async () => {
      const relay = mockRelay();
      const outcome = await reactToNote(mockSigner(), relay, NOTE, THEM);

      const e = relay.published[0];
      expect(e.kind).toBe(REACTION_KIND);
      expect(e.content).toBe('+');
      expect(e.pubkey).toBe(ME);
      expect(e.tags).toEqual([['e', NOTE], ['p', THEM]]);
      expect(outcome).toEqual({ acceptedBy: 3, eventId: 'bb'.repeat(32) });
    });

    it('carries a custom emoji tag through to the event', async () => {
      const relay = mockRelay();
      const emoji = ['emoji', 'wave', 'https://example.com/wave.png'];
      await reactToNote(mockSigner(), relay, NOTE, THEM, ':wave:', [emoji]);

      expect(relay.published[0].content).toBe(':wave:');
      expect(relay.published[0].tags).toContainEqual(emoji);
    });

    it('throws when no relay accepts it', async () => {
      await expect(reactToNote(mockSigner(), mockRelay(0), NOTE, THEM)).rejects.toThrow(
        /No relay accepted/,
      );
    });
  });

  describe('replyToNote', () => {
    it('publishes a trimmed kind:1 with the caller-built tags', async () => {
      const relay = mockRelay();
      const tags = [['e', NOTE, '', 'root'], ['p', THEM]];
      await replyToNote(mockSigner(), relay, '  hi there  ', tags);

      expect(relay.published[0].kind).toBe(NOTE_KIND);
      expect(relay.published[0].content).toBe('hi there');
      expect(relay.published[0].tags).toEqual(tags);
    });

    it('refuses an empty reply without publishing', async () => {
      const relay = mockRelay();
      await expect(replyToNote(mockSigner(), relay, '   ', [])).rejects.toThrow(/needs some text/);
      expect(relay.published).toHaveLength(0);
    });
  });

  describe('retractEvent', () => {
    it('publishes a NIP-09 kind:5 referencing the event', async () => {
      const relay = mockRelay();
      await retractEvent(mockSigner(), relay, NOTE);

      expect(relay.published[0].kind).toBe(DELETE_KIND);
      expect(relay.published[0].tags).toEqual([['e', NOTE]]);
    });
  });

  describe('repostNote', () => {
    it('publishes a kind:6 with the relay hint and author', async () => {
      const relay = mockRelay();
      await repostNote(mockSigner(), relay, NOTE, THEM, 'wss://relay.example');

      expect(relay.published[0].kind).toBe(REPOST_KIND);
      expect(relay.published[0].tags).toEqual([
        ['e', NOTE, 'wss://relay.example', 'mention'],
        ['p', THEM],
      ]);
    });
  });

  describe('postNote', () => {
    it('extracts hashtags once each, lowercased', async () => {
      const relay = mockRelay();
      await postNote(mockSigner(), relay, 'hello #Nostr and #nostr #cloistr');

      const tTags = relay.published[0].tags.filter((t) => t[0] === 't');
      expect(tTags).toEqual([['t', 'nostr'], ['t', 'cloistr']]);
    });

    it('appends already-uploaded media as URLs with imeta tags', async () => {
      const relay = mockRelay();
      await postNote(mockSigner(), relay, 'look', {
        media: [{ url: 'https://files.example/a.png', mimeType: 'image/png' }],
      });

      const e = relay.published[0];
      expect(e.content).toBe('look\nhttps://files.example/a.png');
      expect(e.tags).toContainEqual(['imeta', 'url https://files.example/a.png', 'm image/png']);
    });

    it('allows a media-only post', async () => {
      const relay = mockRelay();
      await postNote(mockSigner(), relay, '', { media: [{ url: 'https://files.example/a.png' }] });
      expect(relay.published[0].content).toBe('https://files.example/a.png');
    });

    it('adds reply, quote and mention tags', async () => {
      const relay = mockRelay();
      await postNote(mockSigner(), relay, 'yes', { replyTo: NOTE, quote: 'ff'.repeat(32), mentions: [THEM] });

      const tags = relay.published[0].tags;
      expect(tags).toContainEqual(['e', NOTE, '', 'reply']);
      expect(tags).toContainEqual(['e', NOTE, '', 'root']);
      expect(tags).toContainEqual(['q', 'ff'.repeat(32)]);
      expect(tags).toContainEqual(['p', THEM]);
    });

    it('refuses an empty post without publishing', async () => {
      const relay = mockRelay();
      await expect(postNote(mockSigner(), relay, '  ')).rejects.toThrow(/empty/);
      expect(relay.published).toHaveLength(0);
    });

    it('throws when no relay accepts it', async () => {
      await expect(postNote(mockSigner(), mockRelay(0), 'hi')).rejects.toThrow(/No relay accepted/);
    });
  });
});
