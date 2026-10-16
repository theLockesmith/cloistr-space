/**
 * @fileoverview Choose files from Stash, for any caller.
 *
 * Returns references ({ name, sha256, size, mimeType }) and nothing else: it
 * never fetches or decrypts a file. sha256 names the encrypted blob, so a
 * reference identifies a file the user opens in Stash; it does not open it.
 */

import { Modal } from '@cloistr/ui';
import type { StashPickedItem } from '@/services/cloistr/stashEmbed';
import { StashEmbedFrame } from './StashEmbedFrame';

interface StashPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onPicked: (items: StashPickedItem[]) => void;
}

export function StashPicker({ isOpen, onClose, onPicked }: StashPickerProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Choose from Stash" size="lg">
      {isOpen && (
        <StashEmbedFrame
          mode="pick"
          onPicked={(items) => {
            onPicked(items);
            onClose();
          }}
          onCancelled={onClose}
        />
      )}
    </Modal>
  );
}
