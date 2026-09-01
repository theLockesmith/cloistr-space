/**
 * @fileoverview Groups services
 * NIP-29 relay-based groups
 */

export { useGroups } from './useGroups';
export { useGroupChat } from './useGroupChat';
export { useGroupActions } from './useGroupActions';
export { useGroupFiles, type GroupFile } from './useGroupFiles';
export { useGroupMembers, type GroupMember } from './useGroupMembers';
export { useGroupOwner, type UseGroupOwnerReturn, type OwnershipResolution } from './useGroupOwner';
export {
  resolveOwnership,
  ownershipClaimIsValid,
  buildTransferTags,
  genesisEvent,
  TRANSFER_TAG,
} from './ownership';
