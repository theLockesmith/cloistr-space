/**
 * @fileoverview The /files page.
 *
 * "Your drive" frames Stash's own file list, which is the only way Space can
 * show a sealed drive without holding the user's root key. "Upload & manage"
 * keeps the existing Drive browser for what the read-only embed cannot do.
 *
 * "Choose from Stash" is the first caller of StashPicker. Picked files are
 * references: Space cannot open them, so they are listed with no link.
 */

import { useState } from 'react';
import type { StashPickedItem } from '@/services/cloistr/stashEmbed';
import { FileBrowser } from './FileBrowser';
import { StashEmbedFrame } from './StashEmbedFrame';
import { StashPicker } from './StashPicker';

type Tab = 'drive' | 'manage';

function formatSize(bytes: number | null): string {
  if (bytes === null) return 'size unknown';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

export function FilesView() {
  const [tab, setTab] = useState<Tab>('drive');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<StashPickedItem[]>([]);

  const tabClass = (t: Tab) =>
    `min-h-[44px] rounded px-3 text-sm ${
      tab === t ? 'bg-cloistr-light/10 font-medium text-cloistr-light' : 'text-cloistr-light/60 hover:text-cloistr-light'
    }`;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" className="flex gap-1">
          <button role="tab" aria-selected={tab === 'drive'} className={tabClass('drive')} onClick={() => setTab('drive')}>
            Your drive
          </button>
          <button role="tab" aria-selected={tab === 'manage'} className={tabClass('manage')} onClick={() => setTab('manage')}>
            Upload &amp; manage
          </button>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="min-h-[44px] rounded bg-cloistr-primary px-3 text-sm font-medium text-white hover:bg-cloistr-primary/90"
        >
          Choose from Stash
        </button>
      </div>

      {picked.length > 0 && (
        <section aria-label="Chosen from Stash" className="rounded border border-cloistr-light/10 p-3">
          <h2 className="mb-2 text-sm font-medium text-cloistr-light">Chosen from Stash</h2>
          <p className="mb-2 text-xs text-cloistr-light/60">Open these in Stash. Space can see which files they are, but not what is in them.</p>
          <ul className="flex flex-col gap-1">
            {picked.map((item) => (
              <li key={item.sha256} className="flex justify-between gap-2 text-sm text-cloistr-light/80">
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 text-cloistr-light/50">{formatSize(item.size)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === 'drive' ? <StashEmbedFrame mode="browse" /> : <FileBrowser />}

      <StashPicker isOpen={pickerOpen} onClose={() => setPickerOpen(false)} onPicked={setPicked} />
    </div>
  );
}
