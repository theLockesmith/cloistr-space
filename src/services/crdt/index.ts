/**
 * @fileoverview CRDT services index
 * Re-exports NIP-0A sync functionality
 */

export {
  NIP0A_KIND,
  NIP0A_D_TAG,
  parseNip0aEvent,
  buildNip0aTags,
  buildNip0aContent,
  mergeNip0aEvents,
  getNip0aFilter,
  isContactTag,
  isValidPubkey,
  // Kind:3 legacy import
  NIP02_KIND,
  parseKind3Event,
  getKind3Filter,
  countKind3Contacts,
} from './nip0a';

export {
  ContactsSyncService,
  type SyncResult,
  type ImportResult,
} from './contactsSync';

export { useContactsSync } from './useContactsSync';
