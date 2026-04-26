/**
 * @fileoverview Group chat component
 * Displays chat messages and allows sending new ones
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useGroupChat } from '@/services/groups';
import type { GroupMessage } from '@/types/groups';

interface GroupChatProps {
  groupId: string;
  groupName: string;
}

export function GroupChat({ groupId, groupName }: GroupChatProps) {
  const { messages, isLoading, error, sendMessage, refresh } = useGroupChat(groupId);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!newMessage.trim() || isSending) return;

    setIsSending(true);
    try {
      await sendMessage(newMessage.trim());
      setNewMessage('');
      inputRef.current?.focus();
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSending(false);
    }
  }, [newMessage, isSending, sendMessage]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // groupName is unused but kept for interface consistency
  void groupName;

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4">
        {isLoading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex animate-pulse gap-3">
                <div className="h-8 w-8 rounded-full bg-cloistr-light/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 rounded bg-cloistr-light/10" />
                  <div className="h-4 w-3/4 rounded bg-cloistr-light/10" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={refresh}
                className="mt-2 text-xs text-cloistr-primary underline hover:no-underline"
              >
                Try again
              </button>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-cloistr-light/60">No messages yet</p>
              <p className="text-xs text-cloistr-light/30">Be the first to say something!</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-cloistr-light/10 p-4">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-3 py-2 text-sm text-cloistr-light placeholder:text-cloistr-light/40 focus:border-cloistr-primary/50 focus:outline-none"
          />
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
            className="rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90 disabled:opacity-50"
          >
            {isSending ? (
              <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: GroupMessage }) {
  const timeStr = formatMessageTime(message.createdAt);
  const displayName = message.authorProfile?.displayName || message.authorProfile?.name || formatPubkey(message.pubkey);

  return (
    <div className="flex gap-3">
      {message.authorProfile?.picture ? (
        <img
          src={message.authorProfile.picture}
          alt=""
          className="h-8 w-8 rounded-full object-cover"
        />
      ) : (
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-cloistr-primary/20 text-xs font-medium text-cloistr-primary">
          {displayName.slice(0, 2).toUpperCase()}
        </div>
      )}
      <div className="flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium text-cloistr-light">{displayName}</span>
          <span className="text-xs text-cloistr-light/60">{timeStr}</span>
        </div>
        <p className="mt-1 text-sm text-cloistr-light/80 whitespace-pre-wrap">{message.content}</p>
      </div>
    </div>
  );
}

function formatMessageTime(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
    date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatPubkey(pubkey: string): string {
  return pubkey.slice(0, 8) + '...';
}
