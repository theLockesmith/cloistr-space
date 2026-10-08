/**
 * @fileoverview Create group modal
 * Form for creating a new NIP-29 group
 */

import { useState, useCallback, useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { useGroupActions } from '@/services/groups/useGroupActions';
import type { PendingGroup } from '@/services/groups/groupService';
import { useToast } from '@/components/common/Toast';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGroupCreated?: (groupId: string) => void;
}

export function CreateGroupModal({ isOpen, onClose, onGroupCreated }: CreateGroupModalProps) {
  const { beginGroupCreation, createGroup, canAct } = useGroupActions();
  // The group being created, and the name it was begun under. Kept across a
  // failed attempt so submitting the same name again finishes that group
  // instead of minting a second one beside a half-made first. Survives closing
  // the modal once anything was published, for the same reason. A different
  // name is a different group: it starts fresh rather than silently finishing
  // (and renaming) the old one. Cleared on success.
  const pendingRef = useRef<{ group: PendingGroup; name: string } | null>(null);
  // Synchronous double-submit guard: isSubmitting state lags a fast second Enter.
  const submittingRef = useRef(false);
  const toast = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [picture, setPicture] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [isOpenGroup, setIsOpenGroup] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLInputElement>(null);

  // Focus trap and keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    // Focus first input when modal opens
    const timer = setTimeout(() => {
      firstFocusRef.current?.focus();
    }, 0);

    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        onClose();
        return;
      }

      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    setName('');
    setDescription('');
    setPicture('');
    setIsPublic(true);
    setIsOpenGroup(false);
    setError(null);
    if (pendingRef.current?.group.published.size === 0) pendingRef.current = null;
    onClose();
  }, [isSubmitting, onClose]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    if (!canAct) {
      setError('Not connected');
      return;
    }

    if (!name.trim()) {
      setError('Group name is required');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    setError(null);

    try {
      const groupName = name.trim();
      if (pendingRef.current?.name !== groupName) {
        pendingRef.current = { group: await beginGroupCreation(groupName), name: groupName };
      }
      const groupId = await createGroup(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          picture: picture.trim() || undefined,
          isPublic,
          isOpen: isOpenGroup,
        },
        pendingRef.current.group,
      );
      pendingRef.current = null;

      toast.success('Group created', `"${name.trim()}" is ready`);
      onGroupCreated?.(groupId);
      handleClose();
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Failed to create group';
      const errorMessage = pendingRef.current?.group.published.size
        ? `${reason} Your group was partly created; submit again with the same name to finish it.`
        : reason;
      setError(errorMessage);
      toast.error('Failed to create group', errorMessage);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }, [canAct, name, description, picture, isPublic, isOpenGroup, beginGroupCreation, createGroup, onGroupCreated, handleClose, toast]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4 bg-black/60 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
        className="relative w-full max-w-md rounded-lg border border-cloistr-light/10 bg-cloistr-dark p-6 shadow-xl my-auto max-h-[90dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 id="create-group-title" className="text-lg font-semibold text-cloistr-light">Create Group</h2>
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded p-1 text-cloistr-light/40 hover:bg-cloistr-light/10 hover:text-cloistr-light disabled:opacity-50"
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
              ref={firstFocusRef}
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
                <p className="text-xs text-cloistr-light/60">Anyone can see this group</p>
              </div>
              <ToggleSwitch checked={isPublic} onChange={setIsPublic} label="Public group" />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-cloistr-light/80">Open membership</p>
                <p className="text-xs text-cloistr-light/60">Anyone can join without approval</p>
              </div>
              <ToggleSwitch checked={isOpenGroup} onChange={setIsOpenGroup} label="Open membership" />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-cloistr-error/20 bg-cloistr-error/5 px-4 py-3">
              <p className="text-sm text-cloistr-error">{error}</p>
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
              className="rounded-md bg-cloistr-primary px-4 py-2 text-sm font-medium text-cloistr-primary-fg hover:bg-cloistr-primary/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Creating...' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}

function ToggleSwitch({ checked, onChange, label }: ToggleSwitchProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      onKeyDown={handleKeyDown}
      className={`relative h-6 w-11 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-cloistr-primary focus:ring-offset-2 focus:ring-offset-cloistr-dark ${
        checked ? 'bg-cloistr-primary' : 'bg-cloistr-light/20'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-cloistr-text transition-transform ${
          checked ? 'left-5' : 'left-0.5'
        }`}
      />
    </button>
  );
}
