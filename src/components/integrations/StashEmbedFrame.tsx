/**
 * @fileoverview Frames Stash's file list (/embed/files) inside Space.
 *
 * The drive's keys stay in Stash's origin; Space only ever receives the
 * messages parseStashEmbedMessage vouches for. Space sends the frame nothing.
 *
 * A frame Stash refuses to render (Space not on its allow-list, Stash down)
 * posts nothing at all, which looks exactly like a frame still loading. So
 * if no 'ready' arrives in time, say so instead of showing an empty box.
 */

import { useEffect, useRef, useState } from 'react';
import { config } from '@/config/environment';
import {
  parseStashEmbedMessage,
  stashEmbedUrl,
  type StashEmbedMode,
  type StashPickedItem,
} from '@/services/cloistr/stashEmbed';

/** How long to wait for the embed's first message before calling it unreachable. */
export const STASH_EMBED_READY_TIMEOUT_MS = 15_000;

const DEFAULT_HEIGHT = 480;

interface StashEmbedFrameProps {
  mode: StashEmbedMode;
  /** Pick mode: the user pressed Choose. References only; nothing here opens a file. */
  onPicked?: (items: StashPickedItem[]) => void;
  /** Pick mode: the user pressed Cancel. */
  onCancelled?: () => void;
  /** Stash's address. Defaults to the configured Drive/Stash service. */
  stashOrigin?: string;
}

export function StashEmbedFrame({ stashOrigin = config.driveApiUrl, ...rest }: StashEmbedFrameProps) {
  const src = stashEmbedUrl({ stashOrigin, parentOrigin: window.location.origin, mode: rest.mode });
  // A new address is a new embed: start over rather than carry the old one's state.
  return <EmbedFrame key={src} src={src} stashOrigin={stashOrigin} {...rest} />;
}

function EmbedFrame({
  src,
  stashOrigin,
  onPicked,
  onCancelled,
}: StashEmbedFrameProps & { src: string; stashOrigin: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Latest callbacks without re-subscribing the listener on every render.
  const handlers = useRef({ onPicked, onCancelled });
  useEffect(() => {
    handlers.current = { onPicked, onCancelled };
  }, [onPicked, onCancelled]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = parseStashEmbedMessage(event, {
        stashOrigin,
        frame: frameRef.current?.contentWindow ?? null,
      });
      if (!msg) return;
      switch (msg.type) {
        case 'ready':
          setSignedIn(msg.signedIn);
          setTimedOut(false);
          break;
        case 'resize':
          setHeight(msg.height);
          break;
        case 'picked':
          handlers.current.onPicked?.(msg.items);
          break;
        case 'cancelled':
          handlers.current.onCancelled?.();
          break;
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [stashOrigin]);

  useEffect(() => {
    if (signedIn !== null) return;
    const timer = setTimeout(() => setTimedOut(true), STASH_EMBED_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [signedIn]);

  return (
    <div className="flex flex-col gap-2">
      {timedOut && (
        <p role="alert" className="rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Stash did not answer. It may be down, or it may not be set up to show your files here.
        </p>
      )}
      {signedIn === false && (
        <p className="rounded bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light/70">
          You are signed out of Stash. Use the sign-in link inside the panel below, then come back.
        </p>
      )}
      <iframe
        ref={frameRef}
        src={src}
        title="Stash files"
        className="w-full rounded border-0"
        style={{ height: `${height}px` }}
      />
    </div>
  );
}
