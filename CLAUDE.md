# CLAUDE.md - cloistr-space

**Nostr-native productivity workspace with Activity, Projects, and Social views.**

## Project Information

- **Company:** Coldforge
- **Type:** Web Application (React + TypeScript)
- **URL:** `space.cloistr.xyz`
- **Registry:** `registry.coldforge.xyz/coldforge/cloistr-space`
- **Repo:** `git@git.coldforge.xyz:coldforge/cloistr-space.git`

**Company Rules:** See [Coldforge CLAUDE.md](~/claude/coldforge/CLAUDE.md)
**Cloistr Rules:** See [Cloistr CLAUDE.md](~/claude/coldforge/cloistr/CLAUDE.md)

## Vision

**Productivity-first, social secondary.** Not another Twitter clone.

Users come for collaboration (Drive, Docs, Groups), stay for the ecosystem. Social exists but isn't the home screen.

### Entry Points
- Shared document links (collaborate, discover ecosystem)
- NIP-29 group invites (join community, use tools)
- Lightning creators (monetize, discover productivity)
- Privacy refugees (escape Big Tech, zero-knowledge tools)
- Self-hosters (run own instance)

### Differentiation
- vs Twitter clones: Activity is home, not feed
- vs Google Workspace: Zero-knowledge, portable
- vs Notion: Decentralized, self-hostable
- vs Signal: Encryption for everything

## Architecture

### Three Core Views

| View | Purpose | Default |
|------|---------|---------|
| **Activity** | Personal dashboard (files, tasks, calendar, mentions) | YES |
| **Projects** | NIP-29 group workspaces with shared resources | |
| **Social** | WoT-filtered Nostr feed | |

### Key Features

- **NIP-0A CRDT Contacts** - Reference implementation for synchronized follow lists
- **Service Integration** - Drive, Docs, Blossom, Calendar, Tasks
- **NIP-46/NIP-07 Auth** - Via cloistr-collab-common
- **WoT Filtering** - Trust-based feed curation
- **Lightning Native** - Zaps throughout

## Quick Commands

```bash
# Development
pnpm install
pnpm dev

# Testing
pnpm lint
pnpm typecheck
pnpm test

# Build
pnpm build
pnpm preview
```

## Project Structure

```
src/
├── components/
│   ├── common/          # Shared UI (Button, Card, Modal, etc.)
│   ├── layout/          # MainLayout, Sidebar, Header, Navigation
│   ├── auth/            # AuthProvider, LoginModal, NIP-46/NIP-07
│   ├── activity/        # Activity dashboard widgets
│   ├── projects/        # NIP-29 group components
│   ├── social/          # Feed, composer, WoT filters
│   ├── contacts/        # NIP-0A CRDT contact management
│   └── integrations/    # Drive, Docs, Blossom, Lightning
├── hooks/               # React hooks (useAuth, useContacts, useWot, etc.)
├── stores/              # Zustand stores (auth, contacts, feed, settings)
├── services/
│   ├── nostr/           # Relay client, event builder, subscriptions
│   ├── cloistr/         # Drive, Docs, Blossom, Signer clients
│   ├── crdt/            # NIP-0A contact list CRDT implementation
│   └── wot/             # Trust calculator, filter engine
├── lib/                 # Utilities (constants, crypto, storage, validation)
├── types/               # TypeScript definitions
└── config/              # Relays, service URLs, environment
```

## Integration Points

### cloistr-collab-common
Authentication and CRDT foundations. Import auth and presence modules.

### cloistr-drive
File browser in Activity view. Group files in Projects view.
API: `https://drive-api.cloistr.xyz`

### cloistr-docs/sheets/whiteboard
Collaborative editing. Embed or link from workspace.

### cloistr-relay
Event storage, WoT filtering, NIP-29 groups.
WebSocket: `wss://relay.cloistr.xyz`

### cloistr-blossom
Media uploads and serving.
API: `https://files.cloistr.xyz`

## NIP-0A Implementation

This client implements the reference NIP-0A synchronized contact list:

- Kind 33000 addressable events
- LWW-Element-Set CRDT merge
- Timestamp-based conflict resolution
- Tombstone deletion markers
- Incremental sync across relays

Goal: Prove the spec works, advance PR #1630.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_RELAY_URL` | `wss://relay.cloistr.xyz` | Primary relay |
| `VITE_SIGNER_URL` | `https://signer.cloistr.xyz` | NIP-46 signer |
| `VITE_DRIVE_API` | `https://drive-api.cloistr.xyz` | Drive API |
| `VITE_BLOSSOM_API` | `https://files.cloistr.xyz` | Blossom API |

## Deployment

GitLab CI builds image, manual deploy to production via ArgoCD.

```bash
# Manual deploy via Atlas
atlas kube apply cloistr-space --kube-context atlantis
```

## Agent Usage

| When | Agent |
|------|-------|
| Starting work | `explore` |
| After code changes | `reviewer` |
| Writing tests | `test-writer` |
| Running tests | `tester` |
| Bugs | `debugger` |

## Autonomous Work Mode

**Work autonomously. Do NOT stop to ask what to do next.**

- Keep working until task complete or genuine blocker
- Make reasonable decisions
- If tests fail, fix them
- Update docs as you progress
