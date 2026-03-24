/**
 * @fileoverview Create group modal
 * Form for creating a new NIP-29 group
 */

import { useState, useCallback, type FormEvent } from 'react';
import { useGroupActions } from '@/services/groups/useGroupActions';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated?: (groupId: string) => void;
}

export function CreateGroupModal({ isOpen, onClose, onGroupCreated }: CreateGroupModalProps) {
  const { createGroup, canAct } = useGroupActions();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picture, setPicture] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isOpenGroup, setIsOpenGroup] = useState(false);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setName('');
    setDescription('');
    setPicture('');
    setIsPublic(true);
    setIsOpenGroup(false);
    setError(null);
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();

    if (!canAct) {
      setError('Not connected');
      return;
    }

    if (!name.trim()) {
      setError('Group name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const groupId = await createGroup({
        name: name.trim(),
        description: description.trim() || undefined,
        picture: picture.trim() || undefined,
        isPublic,
        isOpen: isOpenGroup,
      });

      onGroupCreated?.(groupId);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
    } finally {
      setIsSubmitting(false);
    }
  }, [canAct, name, description, picture, isPublic, isOpenGroup, createGroup, onGroupCreated, handleClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-cloistr-light">Create Group</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light disabled:opacity-50"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="group-name" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Group Name
            </label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My awesome group"
              className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
              required
            />
          </div>

          <div>
            <label htmlFor="group-description" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Description (optional)
            </label>
            <textarea
              id="group-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              rows={2}
              className="w-full resize-none rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="group-picture" className="mb-1 block text-sm font-medium text-cloistr-light/80">
              Picture URL (optional)
            </label>
            <input
              id="group-picture"
              type="url"
              value={picture}
              onChange={(e) => setPicture(e.target.value)}
              placeholder="https://example.com/image.png"
              className="w-full rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-cloistr-light/80">Public group</p>
                <p className="text-xs text-cloistr-light/40">Anyone can see this group</p>
              </div>
              <ToggleSwitch checked={isPublic} onChange={setIsPublic} />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-cloistr-light/80">Open membership</p>
                <p className="text-xs text-cloistr-light/40">Anyone can join without approval</p>
              </div>
              <ToggleSwitch checked={isOpenGroup} onChange={setIsOpenGroup} />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="rounded-md border border-cloistr-light/20 px-4 py-2 text-sm font-medium text-cloistr-light hover:bg-cloistr-light/5 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors ${
        checked ? 'bg-cloistr-primary' : 'bg-cloistr-light/20'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  );
}
