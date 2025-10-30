import type { ContractRouterClient } from '@orpc/contract'
import type { contract } from '../http/contract'
import type { Interceptor } from '../lib/orpc/orpcUniappAdapter'
import { createORPCClient, onError, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { createUniAppORPCClient } from '../lib/orpc/orpcUniappAdapter'

const url = 'http://127.0.0.1:3000/rpc'
let client: ContractRouterClient<typeof contract>

// ✅ 日志拦截器（符合 ORPC 标准）
const loggerInterceptor: Interceptor = async ({ path, input, context, next }) => {
  console.log('→ Request:', path.join('.'), input)
  const start = Date.now()

  try {
    const result = await next({ path, input, context })
    console.log('← Response:', path.join('.'), `${Date.now() - start}ms`)
    return result
  }
  catch (error) {
    console.log('🚀 ~ loggerInterceptor ~ error:', error)
    throw error
  }
}

// #ifndef H5
client = createUniAppORPCClient({
  url,
  interceptors: [
    async ({ next }) => {
      const startTime = performance.now()
      try {
        return next()
      }
      finally {
        const duration = performance.now() - startTime
        console.log('🚀 ~ interceptors ~ duration:', duration)
        console.log('🚀 ~ interceptors ~ duration :', next)
      }
    },
    onError((error) => {
      console.error('🚀 ~interceptors onError ~ error:', error)
    }),

  ],
  clientInterceptors: [
    async ({ next }) => {
      const startTime = performance.now()
      try {
        return next()
      }
      finally {
        const duration = performance.now() - startTime
        console.log('🚀 ~ clientInterceptors ~ duration :', duration)
        console.log('🚀 ~ clientInterceptors ~ duration :', next)
      }
    },
    onError((error) => {
      console.error('🚀 ~clientInterceptors onError ~ error:', error)
    }),

  ],
})
// #endif

// #ifdef H5
const link = new RPCLink({
  url,
  interceptors: [
    loggerInterceptor,
    async ({ next }) => {
      const startTime = performance.now()

      try {
        return next()
      }
      finally {
        const duration = performance.now() - startTime
        console.log('🚀 ~ interceptors ~ duration:', duration)
      }
    },
  ],
  clientInterceptors: [
    async ({ next }) => {
      const startTime = performance.now()
      try {
        return next()
      }
      finally {
        const duration = performance.now() - startTime
      }
    },
    onError((error) => {
      console.error('🚀 ~ onError ~ error:', error)
    }),
  ],
})
client = createORPCClient(link)
// #endif

export const orpc = createTanstackQueryUtils(client)

export async function testStream() {
  const controller = new AbortController()

  // ✅ 不要 await,先保存 Promise
  const requestPromise = client.todo.list(
    { text: '10' },
    { signal: controller.signal },
  )

  // ✅ 立即设置取消逻辑(在请求进行中)
  setTimeout(() => {
    console.log('⏰ 触发 abort')
    controller.abort()
  }, 1000)

  // ✅ 现在 await,并处理取消错误
  try {
    const result1 = await requestPromise
    console.log('✅ 请求成功:', result1)
  }
  catch (error) {
    if (error instanceof ORPCError) {
      console.log('🚫 请求被取消:', error.message)
    }
    else {
      console.error('❌ 请求失败:', error)
    }
  }

  const result = await client.sse(undefined, { context: { stream: true } })

  for await (const value of result) {
    console.log('🚀 ~ testStream ~ value:', value)
  }
}
