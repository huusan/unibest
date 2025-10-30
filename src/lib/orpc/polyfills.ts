// #ifdef MP-WEIXIN || MP-ALIPAY || MP-BAIDU || MP-TOUTIAO || MP-QQ || APP-PLUS
// 导入 web-streams-polyfill 以提供完整的 Streams API 实现
import 'web-streams-polyfill/dist/polyfill.js'

// 确保 TransformStream 在全局范围内可用
if (typeof globalThis.TransformStream === 'undefined') {
  // 提供一个基本的 TransformStream 实现
  globalThis.TransformStream = class TransformStream {
    constructor() {}
    get readable() {
      return {
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined }),
          releaseLock: () => {},
        }),
      }
    }

    get writable() {
      return {
        getWriter: () => ({
          write: () => Promise.resolve(),
          close: () => Promise.resolve(),
          abort: () => Promise.resolve(),
        }),
      }
    }
  } as any
}
// #endif
