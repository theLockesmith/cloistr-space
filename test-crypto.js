console.log('Node.js version:', process.version);
console.log('Global crypto exists:', typeof globalThis.crypto !== 'undefined');
if (typeof globalThis.crypto !== 'undefined') {
  console.log('crypto.subtle exists:', !!globalThis.crypto.subtle);
  console.log('crypto.randomUUID exists:', !!globalThis.crypto.randomUUID);
}

const cryptoModule = require('crypto');
console.log('Node webcrypto exists:', !!cryptoModule.webcrypto);
if (cryptoModule.webcrypto) {
  console.log('Node webcrypto.subtle exists:', !!cryptoModule.webcrypto.subtle);
}