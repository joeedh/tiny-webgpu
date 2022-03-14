globalThis.window = globalThis;

import('./preprocessor.js').then(mod => {
  globalThis.testPreprocessor();
});