/**
 * @fileoverview Group threads (NIP-22) index
 */

export {
  THREAD_KIND,
  buildThreadRootTags,
  buildReplyTags,
  parseThreadEvent,
  assembleThreads,
  type ThreadComment,
  type ThreadNode,
  type Thread,
  type ReplyTarget,
} from './threadEvents';

export { useThreads } from './useThreads';

export { useAllThreads, type ThreadWithGroup, type UseAllThreadsReturn } from './useAllThreads';

export {
  ThreadKeyStore,
  KEY_WRAP_KIND,
  decryptThreadContent,
  encryptThreadContent,
  buildKeyWrapEvent,
  looksLikeNip44,
  type ThreadKey,
} from './threadKeyStore';

export {
  useThreadKeyStore,
  useThreadKeyLoader,
} from './useThreadKeyStore';

export { useThreadKeyGrant } from './useThreadKeyGrant';

// Bucketed blind mailbox — sealed thread read/write via kind 1059 gift wraps
export {
  BUCKET_BITS,
  WINDOW_SECONDS,
  BUCKETS_PER_READER,
  getWindowId,
  computeThreadBucket,
  computeHandoffBucket,
  generateBucketSet,
  bucketToTag,
  tagToBucket,
  jitteredTimestamp,
} from './bucketCrypto';

export {
  GIFT_WRAP_KIND,
  wrapThreadMessage,
  tryUnwrapMessage,
  wrapKeyHandoff,
  tryUnwrapHandoff,
  type ThreadRumor,
  type UnwrappedMessage,
  type UnwrappedHandoff,
} from './giftWrap';

export {
  useBucketReader,
  computeRealBuckets,
  type BucketReaderReturn,
} from './useBucketReader';

export {
  useBucketWriter,
  type BucketWriterReturn,
} from './useBucketWriter';
