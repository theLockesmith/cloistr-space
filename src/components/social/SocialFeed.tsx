import { useState } from 'react';

export function SocialFeed() {
  const [posts] = useState([
    {
      id: '1',
      author: {
        pubkey: 'npub1abc123...',
        name: 'Satoshi',
        picture: null,
      },
      content: 'Just deployed the NIP-0A reference implementation. Contact list sync is finally working across clients!',
      createdAt: '5 minutes ago',
      reactions: 42,
      replies: 7,
      zaps: 21000,
    },
    {
      id: '2',
      author: {
        pubkey: 'npub1xyz789...',
        name: 'Alice',
        picture: null,
      },
      content: 'The collaboration features in Cloistr are incredible. Zero-knowledge docs that actually work.',
      createdAt: '1 hour ago',
      reactions: 128,
      replies: 23,
      zaps: 50000,
    },
    {
      id: '3',
      author: {
        pubkey: 'npub1def456...',
        name: 'Bob',
        picture: null,
      },
      content: 'Working on the next phase of relay discovery. Geographic distribution is going to be huge for performance.',
      createdAt: '3 hours ago',
      reactions: 67,
      replies: 12,
      zaps: 15000,
    },
  ]);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Compose */}
      <div className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4">
        <textarea
          placeholder="What's on your mind?"
          rows={3}
          className="w-full resize-none rounded-lg border border-cloistr-light/10 bg-transparent p-3 text-sm text-cloistr-light placeholder-cloistr-light/40 focus:border-cloistr-primary focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="flex gap-2">
            <button className="rounded-lg p-2 text-cloistr-light/40 hover:bg-cloistr-light/5 hover:text-cloistr-light">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </button>
            <button className="rounded-lg p-2 text-cloistr-light/40 hover:bg-cloistr-light/5 hover:text-cloistr-light">
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </button>
          </div>
          <button className="rounded-lg bg-cloistr-primary px-4 py-2 text-sm font-medium text-white hover:bg-cloistr-primary/90">
            Post
          </button>
        </div>
      </div>

      {/* WoT Filter bar */}
      <div className="flex items-center gap-4 rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 px-4 py-2">
        <span className="text-sm text-cloistr-light/60">Filter:</span>
        <div className="flex gap-2">
          <FilterButton active>Following</FilterButton>
          <FilterButton>WoT</FilterButton>
          <FilterButton>Global</FilterButton>
        </div>
        <div className="ml-auto">
          <button className="flex items-center gap-1 text-sm text-cloistr-light/40 hover:text-cloistr-light">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Settings
          </button>
        </div>
      </div>

      {/* Feed */}
      <div className="space-y-4">
        {posts.map((post) => (
          <article
            key={post.id}
            className="rounded-lg border border-cloistr-light/10 bg-cloistr-light/5 p-4"
          >
            {/* Author */}
            <div className="mb-3 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-cloistr-primary/20" />
              <div>
                <p className="font-medium text-cloistr-light">{post.author.name}</p>
                <p className="text-xs text-cloistr-light/40">{post.createdAt}</p>
              </div>
            </div>

            {/* Content */}
            <p className="mb-4 text-sm text-cloistr-light/90">{post.content}</p>

            {/* Actions */}
            <div className="flex items-center gap-6 border-t border-cloistr-light/10 pt-3">
              <button className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-cloistr-light">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                {post.replies}
              </button>
              <button className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-red-400">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
                {post.reactions}
              </button>
              <button className="flex items-center gap-2 text-sm text-cloistr-light/40 hover:text-cloistr-accent">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {formatSats(post.zaps)}
              </button>
              <button className="ml-auto text-cloistr-light/40 hover:text-cloistr-light">
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

function FilterButton({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      className={`rounded-md px-3 py-1 text-sm transition-colors ${
        active
          ? 'bg-cloistr-primary text-white'
          : 'text-cloistr-light/60 hover:bg-cloistr-light/5 hover:text-cloistr-light'
      }`}
    >
      {children}
    </button>
  );
}

function formatSats(sats: number): string {
  if (sats >= 1000000) {
    return `${(sats / 1000000).toFixed(1)}M`;
  }
  if (sats >= 1000) {
    return `${(sats / 1000).toFixed(1)}k`;
  }
  return sats.toString();
}
