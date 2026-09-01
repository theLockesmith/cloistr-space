/**
 * @fileoverview Groups services
 * NIP-29 relay-based groups
 */

export { useGroups } from './useGroups';
export { useGroupChat } from './useGroupChat';
export { useGroupActions } from './useGroupActions';
export { useGroupFiles, type GroupFile } from './useGroupFiles';
export { useGroupMembers, type GroupMember } from './useGroupMembers';
export { useGroupOwner, type UseGroupOwnerReturn } from './useGroupOwner';
export {
  resolveOwnership,
  ownershipClaimIsValid,
  buildGroupIdentifier,
  extractOwnerPrefix,
  buildTransferTags,
  genesisEvent,
  TRANSFER_TAG,
  type OwnershipResolution,
} from './ownership';
