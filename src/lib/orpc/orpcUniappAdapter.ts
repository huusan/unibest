import type { ClientOptions } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { EventSourceMessage } from '../FetchEventSource/parse'
import {
  COMMON_ORPC_ERROR_DEFS,
  createORPCClient,
  DynamicLink,
  onError,
  onFinish,
  onStart,
  onSuccess,
  ORPCError,
} from '@orpc/client'
import { EventStreamContentType, fetchEventSource } from '../FetchEventSource/fetch'

// ========== 拦截器类型定义 ==========

/**
 * ORPC 标准拦截器接口
 */
export type Interceptor<Context = any> = (options: {
  path: readonly string[]
  input: unknown
  context: Context
  next: (opts?: {
    path?: readonly string[]
    input?: unknown
    context?: Context
  }) => Promise<unknown>
}) => Promise<unknown>

/**
 * 客户端拦截器接口 - 可以访问完整的 request 对象
 */
export type ClientInterceptor<Context = any> = (options: {
  path: readonly string[]
  input: unknown
  context: Context
  request: {
    url: string
    method: string
    headers: Record<string, string>
    body: any
  }
  next: (opts?: {
    path?: readonly string[]
    input?: unknown
    context?: Context
    request?: {
      url?: string
      method?: string
      headers?: Record<string, string>
      body?: any
    }
  }) => Promise<unknown>
}) => Promise<unknown>

// ========== 配置接口 ==========

export interface UniAppRPCLinkConfig {
  url: string
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
  timeout?: number
  interceptors?: Interceptor[]
  clientInterceptors?: ClientInterceptor[]
}

// ========== 错误映射工具 ==========

function getErrorCodeFromStatus(statusCode: number): string {
  for (const [code, def] of Object.entries(COMMON_ORPC_ERROR_DEFS)) {
    if (def.status === statusCode) {
      return code
    }
  }

  if (statusCode >= 500)
    return 'INTERNAL_SERVER_ERROR'
  if (statusCode >= 400)
    return 'BAD_REQUEST'
  return 'INTERNAL_SERVER_ERROR'
}

function isStandardORPCError(code: string): boolean {
  return code in COMMON_ORPC_ERROR_DEFS
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('abort'))
}

// ========== RPC 工具类 ==========

class RPCUtils {
  private static readonly META_TYPES = {
    0: 'bigint',
    1: 'date',
    2: 'nan',
    3: 'undefined',
    4: 'url',
    5: 'regexp',
    6: 'set',
    7: 'map',
  } as const

  static extractData(data: any): any {
    if (!data || typeof data !== 'object')
      return data

    const jsonData = data.json ?? data
    const meta = data.meta

    if (!meta || !Array.isArray(meta) || meta.length === 0) {
      return jsonData
    }

    const result = this.deepClone(jsonData)

    for (const metaEntry of meta) {
      if (!Array.isArray(metaEntry) || metaEntry.length < 2) {
        continue
      }

      const [type, ...path] = metaEntry
      this.applyMetaTransform(result, path, type)
    }

    return result
  }

  private static applyMetaTransform(obj: any, path: (string | number)[], type: number): void {
    if (path.length === 0)
      return

    let current = obj
    const lastKey = path[path.length - 1]

    for (let i = 0; i < path.length - 1; i++) {
      const key = path[i]
      if (current[key] === undefined || current[key] === null) {
        return
      }
      current = current[key]
    }

    const value = current[lastKey]
    current[lastKey] = this.deserializeValue(value, type)
  }

  private static deserializeValue(value: any, type: number): any {
    switch (type) {
      case 0: return typeof value === 'string' ? BigInt(value) : value
      case 1: return typeof value === 'string' ? new Date(value) : value
      case 2: return Number.NaN
      case 3: return undefined
      case 4: return typeof value === 'string' ? new URL(value) : value
      case 5: {
        if (typeof value === 'string') {
          const match = value.match(/^\/(.*)\/([ gimsuvy]*)$/)
          return match ? new RegExp(match[1], match[2]) : new RegExp(value)
        }
        return value
      }
      case 6: return Array.isArray(value) ? new Set(value) : value
      case 7: return Array.isArray(value) ? new Map(value) : value
      default: return value
    }
  }

  private static deepClone(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepClone(item))
    }

    const cloned: any = {}
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        cloned[key] = this.deepClone(obj[key])
      }
    }
    return cloned
  }

  static extractError(response: { statusCode?: number, data?: any, status?: number }): ORPCError<any, any> | null {
    const statusCode = response.statusCode ?? response.status

    if (!statusCode || statusCode < 400) {
      return null
    }

    const data = (response as any).data
    const errorPayload = data?.json ?? data

    if (errorPayload?.code && typeof errorPayload.code === 'string') {
      const code = isStandardORPCError(errorPayload.code)
        ? errorPayload.code
        : getErrorCodeFromStatus(statusCode)

      return new ORPCError(code, {
        message: errorPayload.message ?? COMMON_ORPC_ERROR_DEFS[code]?.message,
        data: errorPayload.data,
        cause: errorPayload.cause,
      })
    }

    const code = getErrorCodeFromStatus(statusCode)
    const errorDef = COMMON_ORPC_ERROR_DEFS[code]

    const message = errorPayload?.message
      ?? (typeof errorPayload === 'string' ? errorPayload : undefined)
      ?? errorDef?.message
      ?? `HTTP ${statusCode}`

    return new ORPCError(code, {
      message,
      data: typeof errorPayload === 'object' ? errorPayload : undefined,
    })
  }

  static isEndMarker(data: any): boolean {
    if (!data || data === '[DONE]')
      return true
    if (typeof data !== 'object')
      return false
    if (Object.keys(data).length === 0)
      return true
    return ['done', 'finish', 'end', 'complete'].some(field => (data as any)[field] === true)
  }

  static async resolveHeaders(
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>),
  ): Promise<Record<string, string>> {
    return typeof headers === 'function' ? await headers() : headers ?? {}
  }
}

// ========== UniApp HTTP Link ==========

export class UniAppHTTPLink<Context = any> {
  private readonly config: {
    url: string
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
    timeout: number
    interceptors: Interceptor<Context>[]
    clientInterceptors: ClientInterceptor<Context>[]
  }

  constructor(config: UniAppRPCLinkConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''),
      headers: config.headers,
      timeout: config.timeout ?? 30000,
      interceptors: config.interceptors ?? [],
      clientInterceptors: config.clientInterceptors ?? [],
    }
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<Context>): Promise<unknown> {
    const hasInterceptors = this.config.interceptors.length > 0 || this.config.clientInterceptors.length > 0

    if (hasInterceptors) {
      return this.executeWithInterceptors(path, input, options, 0)
    }

    return this.executeRequest(path, input, options)
  }

  private async executeWithInterceptors(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    index: number,
  ): Promise<unknown> {
    // 第一阶段：执行普通拦截器
    if (index < this.config.interceptors.length) {
      const interceptor = this.config.interceptors[index]

      return interceptor({
        path,
        input,
        context: options.context as Context ?? {} as Context,
        next: async (nextOptions) => {
          const nextPath = nextOptions?.path ?? path
          const nextInput = nextOptions?.input ?? input
          const nextContext = nextOptions?.context
            ? { ...(options.context as any), ...nextOptions.context }
            : options.context

          const result = await this.executeWithInterceptors(
            nextPath,
            nextInput,
            { ...options, context: nextContext },
            index + 1,
          )

          // 包装 AsyncGenerator
          if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
            return this.wrapAsyncGenerator(result as AsyncGenerator, path, input, options, index + 1)
          }

          return result
        },
      })
    }

    // 第二阶段：执行客户端拦截器
    const clientInterceptorIndex = index - this.config.interceptors.length
    if (clientInterceptorIndex < this.config.clientInterceptors.length) {
      // 创建初始 request 对象
      const headers = await RPCUtils.resolveHeaders(this.config.headers)
      const request = {
        url: `${this.config.url}/${path.join('/')}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: { json: input },
      }

      return this.executeClientInterceptor(path, input, options, clientInterceptorIndex, request)
    }

    // 最终执行请求
    return this.executeRequest(path, input, options)
  }

  private async executeClientInterceptor(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    index: number,
    request: { url: string, method: string, headers: Record<string, string>, body: any },
  ): Promise<unknown> {
    if (index >= this.config.clientInterceptors.length) {
      // 使用修改后的 request 执行请求
      return this.executeRequestWithCustomConfig(request, options)
    }

    const interceptor = this.config.clientInterceptors[index]

    return interceptor({
      path,
      input,
      context: options.context as Context ?? {} as Context,
      request,
      next: async (nextOptions) => {
        const nextPath = nextOptions?.path ?? path
        const nextInput = nextOptions?.input ?? input
        const nextContext = nextOptions?.context
          ? { ...(options.context as any), ...nextOptions.context }
          : options.context

        // 合并 request 修改
        const nextRequest = {
          url: nextOptions?.request?.url ?? request.url,
          method: nextOptions?.request?.method ?? request.method,
          headers: nextOptions?.request?.headers
            ? { ...request.headers, ...nextOptions.request.headers }
            : request.headers,
          body: nextOptions?.request?.body ?? request.body,
        }

        const result = await this.executeClientInterceptor(
          nextPath,
          nextInput,
          { ...options, context: nextContext },
          index + 1,
          nextRequest,
        )

        // 包装 AsyncGenerator
        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          return this.wrapAsyncGenerator(
            result as AsyncGenerator,
            path,
            input,
            options,
            this.config.interceptors.length + index + 1,
          )
        }

        return result
      },
    })
  }

  // 包装 AsyncGenerator 使错误能被拦截器捕获
  private async* wrapAsyncGenerator(
    generator: AsyncGenerator,
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    startIndex: number,
  ): AsyncGenerator {
    try {
      for await (const chunk of generator) {
        yield chunk
      }
    }
    catch (error) {
      // 只在最外层（第一个拦截器）处理错误
      if (!(error as any).__orpc_error_handled__) {
        (error as any).__orpc_error_handled__ = true
        await this.executeErrorInterceptors(error, path, input, options, startIndex)
      }
      throw error
    }
  }

  // 执行错误拦截器
  private async executeErrorInterceptors(
    error: unknown,
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    startIndex: number,
  ): Promise<void> {
    // 反向执行拦截器的错误处理
    const totalInterceptors = this.config.interceptors.length + this.config.clientInterceptors.length

    for (let i = Math.min(startIndex, totalInterceptors - 1); i >= 0; i--) {
      if (i < this.config.interceptors.length) {
        // 普通拦截器
        const interceptor = this.config.interceptors[i]
        try {
          await interceptor({
            path,
            input,
            context: options.context as Context ?? {} as Context,
            next: async () => {
              throw error
            },
          })
        }
        catch (e) {
          if (e !== error) {
            console.warn('[UniApp ORPC] Interceptor error handler threw:', e)
          }
        }
      }
      else {
        // 客户端拦截器
        const clientInterceptorIndex = i - this.config.interceptors.length
        const interceptor = this.config.clientInterceptors[clientInterceptorIndex]
        const headers = await RPCUtils.resolveHeaders(this.config.headers)
        const request = {
          url: `${this.config.url}/${path.join('/')}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: { json: input },
        }

        try {
          await interceptor({
            path,
            input,
            context: options.context as Context ?? {} as Context,
            request,
            next: async () => {
              throw error
            },
          })
        }
        catch (e) {
          if (e !== error) {
            console.warn('[UniApp ORPC] Client interceptor error handler threw:', e)
          }
        }
      }
    }
  }

  private async executeRequest(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
  ): Promise<unknown> {
    const headers = await RPCUtils.resolveHeaders(this.config.headers)
    const url = `${this.config.url}/${path.join('/')}`
    const signal = options.signal

    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
          message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
        }))
        return
      }

      let isAborted = false
      let requestTask: UniApp.RequestTask | null = null
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let abortHandler: (() => void) | null = null

      requestTask = uni.request({
        url,
        method: 'POST',
        header: { 'Content-Type': 'application/json', ...headers },
        data: { json: input },
        dataType: 'json',
        timeout: this.config.timeout,

        success: (res) => {
          if (isAborted)
            return
          if (timeoutId)
            clearTimeout(timeoutId)
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }

          const error = RPCUtils.extractError({ statusCode: res.statusCode, data: res.data })
          if (error) {
            reject(error)
          }
          else {
            resolve(RPCUtils.extractData(res.data))
          }
        },

        fail: (err) => {
          if (isAborted)
            return
          if (timeoutId)
            clearTimeout(timeoutId)
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }

          if (isAbortError(err)) {
            reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
              message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
              cause: err,
            }))
            return
          }

          reject(new ORPCError('SERVICE_UNAVAILABLE', {
            message: COMMON_ORPC_ERROR_DEFS.SERVICE_UNAVAILABLE.message,
            cause: err,
          }))
        },
      })

      if (this.config.timeout && this.config.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (isAborted)
            return
          isAborted = true
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }
          requestTask?.abort()
          reject(new ORPCError('TIMEOUT', {
            message: `${COMMON_ORPC_ERROR_DEFS.TIMEOUT.message}: ${this.config.timeout}ms`,
          }))
        }, this.config.timeout)
      }

      if (signal) {
        abortHandler = () => {
          if (isAborted)
            return
          isAborted = true
          if (timeoutId)
            clearTimeout(timeoutId)
          requestTask?.abort()
          reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
            message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
          }))
        }

        if (signal.aborted) {
          abortHandler()
        }
        else {
          signal.addEventListener('abort', abortHandler, { once: true })
        }
      }
    })
  }

  private async executeRequestWithCustomConfig(
    request: { url: string, method: string, headers: Record<string, string>, body: any },
    options: ClientOptions<Context>,
  ): Promise<unknown> {
    const signal = options.signal

    return new Promise<unknown>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
          message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
        }))
        return
      }

      let isAborted = false
      let requestTask: UniApp.RequestTask | null = null
      let timeoutId: ReturnType<typeof setTimeout> | null = null
      let abortHandler: (() => void) | null = null

      requestTask = uni.request({
        url: request.url,
        method: request.method as any,
        header: request.headers,
        data: request.body,
        dataType: 'json',
        timeout: this.config.timeout,

        success: (res) => {
          if (isAborted)
            return
          if (timeoutId)
            clearTimeout(timeoutId)
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }

          const error = RPCUtils.extractError({ statusCode: res.statusCode, data: res.data })
          if (error) {
            reject(error)
          }
          else {
            resolve(RPCUtils.extractData(res.data))
          }
        },

        fail: (err) => {
          if (isAborted)
            return
          if (timeoutId)
            clearTimeout(timeoutId)
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }

          if (isAbortError(err)) {
            reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
              message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
              cause: err,
            }))
            return
          }

          reject(new ORPCError('SERVICE_UNAVAILABLE', {
            message: COMMON_ORPC_ERROR_DEFS.SERVICE_UNAVAILABLE.message,
            cause: err,
          }))
        },
      })

      if (this.config.timeout && this.config.timeout > 0) {
        timeoutId = setTimeout(() => {
          if (isAborted)
            return
          isAborted = true
          // 清理 abort 监听器
          if (signal && abortHandler) {
            signal.removeEventListener('abort', abortHandler)
          }
          requestTask?.abort()
          reject(new ORPCError('TIMEOUT', {
            message: `${COMMON_ORPC_ERROR_DEFS.TIMEOUT.message}: ${this.config.timeout}ms`,
          }))
        }, this.config.timeout)
      }

      if (signal) {
        abortHandler = () => {
          if (isAborted)
            return
          isAborted = true
          if (timeoutId)
            clearTimeout(timeoutId)
          requestTask?.abort()
          reject(new ORPCError('CLIENT_CLOSED_REQUEST', {
            message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
          }))
        }

        if (signal.aborted) {
          abortHandler()
        }
        else {
          signal.addEventListener('abort', abortHandler, { once: true })
        }
      }
    })
  }
}

// ========== UniApp SSE Link ==========

export class UniAppSSELink<Context = any> {
  private readonly config: {
    url: string
    headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>)
    timeout: number
    interceptors: Interceptor<Context>[]
    clientInterceptors: ClientInterceptor<Context>[]
  }

  constructor(config: UniAppRPCLinkConfig) {
    this.config = {
      url: config.url.replace(/\/$/, ''),
      headers: config.headers,
      timeout: config.timeout ?? 0,
      interceptors: config.interceptors ?? [],
      clientInterceptors: config.clientInterceptors ?? [],
    }
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<Context>): Promise<unknown> {
    const hasInterceptors = this.config.interceptors.length > 0 || this.config.clientInterceptors.length > 0

    if (hasInterceptors) {
      return this.executeWithInterceptors(path, input, options, 0)
    }

    return this.executeRequest(path, input, options)
  }

  private async executeWithInterceptors(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    index: number,
  ): Promise<unknown> {
    // 第一阶段：执行普通拦截器
    if (index < this.config.interceptors.length) {
      const interceptor = this.config.interceptors[index]

      return interceptor({
        path,
        input,
        context: options.context as Context ?? {} as Context,
        next: async (nextOptions) => {
          const nextPath = nextOptions?.path ?? path
          const nextInput = nextOptions?.input ?? input
          const nextContext = nextOptions?.context
            ? { ...(options.context as any), ...nextOptions.context }
            : options.context

          const result = await this.executeWithInterceptors(
            nextPath,
            nextInput,
            { ...options, context: nextContext },
            index + 1,
          )

          // 包装 AsyncGenerator
          if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
            return this.wrapAsyncGenerator(result as AsyncGenerator, path, input, options, index + 1)
          }

          return result
        },
      })
    }

    // 第二阶段：执行客户端拦截器
    const clientInterceptorIndex = index - this.config.interceptors.length
    if (clientInterceptorIndex < this.config.clientInterceptors.length) {
      const headers = await RPCUtils.resolveHeaders(this.config.headers)
      const request = {
        url: `${this.config.url}/${path.join('/')}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': EventStreamContentType, ...headers },
        body: { json: input },
      }

      return this.executeClientInterceptor(path, input, options, clientInterceptorIndex, request)
    }

    // 最终执行请求
    return this.executeRequest(path, input, options)
  }

  private async executeClientInterceptor(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    index: number,
    request: { url: string, method: string, headers: Record<string, string>, body: any },
  ): Promise<unknown> {
    if (index >= this.config.clientInterceptors.length) {
      return this.executeRequestWithCustomConfig(request, options)
    }

    const interceptor = this.config.clientInterceptors[index]

    return interceptor({
      path,
      input,
      context: options.context as Context ?? {} as Context,
      request,
      next: async (nextOptions) => {
        const nextPath = nextOptions?.path ?? path
        const nextInput = nextOptions?.input ?? input
        const nextContext = nextOptions?.context
          ? { ...(options.context as any), ...nextOptions.context }
          : options.context

        const nextRequest = {
          url: nextOptions?.request?.url ?? request.url,
          method: nextOptions?.request?.method ?? request.method,
          headers: nextOptions?.request?.headers
            ? { ...request.headers, ...nextOptions.request.headers }
            : request.headers,
          body: nextOptions?.request?.body ?? request.body,
        }

        const result = await this.executeClientInterceptor(
          nextPath,
          nextInput,
          { ...options, context: nextContext },
          index + 1,
          nextRequest,
        )

        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          return this.wrapAsyncGenerator(
            result as AsyncGenerator,
            path,
            input,
            options,
            this.config.interceptors.length + index + 1,
          )
        }

        return result
      },
    })
  }

  private async* wrapAsyncGenerator(
    generator: AsyncGenerator,
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    startIndex: number,
  ): AsyncGenerator {
    try {
      for await (const chunk of generator) {
        yield chunk
      }
    }
    catch (error) {
      // 只在最外层（第一个拦截器）处理错误
      if (!(error as any).__orpc_error_handled__) {
        (error as any).__orpc_error_handled__ = true
        await this.executeErrorInterceptors(error, path, input, options, startIndex)
      }
      throw error
    }
  }

  private async executeErrorInterceptors(
    error: unknown,
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
    startIndex: number,
  ): Promise<void> {
    const totalInterceptors = this.config.interceptors.length + this.config.clientInterceptors.length

    for (let i = Math.min(startIndex, totalInterceptors - 1); i >= 0; i--) {
      if (i < this.config.interceptors.length) {
        const interceptor = this.config.interceptors[i]
        try {
          await interceptor({
            path,
            input,
            context: options.context as Context ?? {} as Context,
            next: async () => {
              throw error
            },
          })
        }
        catch (e) {
          if (e !== error) {
            console.warn('[UniApp ORPC] Interceptor error handler threw:', e)
          }
        }
      }
      else {
        const clientInterceptorIndex = i - this.config.interceptors.length
        const interceptor = this.config.clientInterceptors[clientInterceptorIndex]
        const headers = await RPCUtils.resolveHeaders(this.config.headers)
        const request = {
          url: `${this.config.url}/${path.join('/')}`,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': EventStreamContentType, ...headers },
          body: { json: input },
        }

        try {
          await interceptor({
            path,
            input,
            context: options.context as Context ?? {} as Context,
            request,
            next: async () => {
              throw error
            },
          })
        }
        catch (e) {
          if (e !== error) {
            console.warn('[UniApp ORPC] Client interceptor error handler threw:', e)
          }
        }
      }
    }
  }

  private async executeRequest(
    path: readonly string[],
    input: unknown,
    options: ClientOptions<Context>,
  ): Promise<unknown> {
    const headers = await RPCUtils.resolveHeaders(this.config.headers)
    const url = `${this.config.url}/${path.join('/')}`

    return new Promise<AsyncGenerator<any, void, unknown>>((resolve, reject) => {
      const abortController = new AbortController()
      const signal = options.signal ?? abortController.signal
      let externalAbortHandler: (() => void) | null = null

      let hasResolved = false
      let streamError: Error | null = null
      let isStreamFinished = false
      let isConnectionClosed = false

      const buffer: any[] = []
      let bufferResolver: (() => void) | null = null

      let reconnectCount = 0
      const MAX_RECONNECTS = 0

      const resolveBuffer = () => bufferResolver?.()

      // 清理函数
      const cleanup = () => {
        if (options.signal && externalAbortHandler) {
          options.signal.removeEventListener('abort', externalAbortHandler)
          externalAbortHandler = null
        }
        bufferResolver = null
      }

      async function* createStreamGenerator() {
        try {
          while (true) {
            if (streamError)
              throw streamError

            if (isStreamFinished && buffer.length === 0) {
              break
            }

            if (buffer.length > 0) {
              yield buffer.shift()
            }
            else {
              if (isConnectionClosed && !isStreamFinished) {
                await new Promise<void>(r => setTimeout(r, 100))
                continue
              }

              await new Promise<void>((r) => {
                bufferResolver = r
              })
            }
          }
        }
        finally {
          abortController.abort()
          cleanup()
        }
      }

      const handleError = (error: any) => {
        const orpcError = error instanceof ORPCError
          ? error
          : new ORPCError('INTERNAL_SERVER_ERROR', {
            message: COMMON_ORPC_ERROR_DEFS.INTERNAL_SERVER_ERROR.message,
            cause: error,
          })

        if (!hasResolved) {
          cleanup()
          reject(orpcError)
        }
        else {
          streamError = orpcError
          resolveBuffer()
        }
      }

      // 监听外部 signal
      if (options.signal) {
        externalAbortHandler = () => {
          abortController.abort()
          handleError(new ORPCError('CLIENT_CLOSED_REQUEST', {
            message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
          }))
        }

        if (options.signal.aborted) {
          externalAbortHandler()
          return
        }
        else {
          options.signal.addEventListener('abort', externalAbortHandler, { once: true })
        }
      }

      fetchEventSource(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': EventStreamContentType, ...headers },
        data: { json: input },
        signal,
        openWhenHidden: false,

        onopen: async (res: any) => {
          if (signal.aborted)
            return

          const status = typeof res?.status === 'number' ? res.status : res?.statusCode
          const ok = typeof res?.ok === 'boolean' ? res.ok : (typeof status === 'number' ? status >= 200 && status < 300 : true)

          if (!ok || (typeof status === 'number' && status >= 400)) {
            const err = RPCUtils.extractError({ status, data: res })
              ?? new ORPCError(getErrorCodeFromStatus(status!), {
                message: `SSE ${COMMON_ORPC_ERROR_DEFS[getErrorCodeFromStatus(status!)]?.message ?? 'connection failed'}: ${status}`,
              })
            handleError(err)
            abortController.abort()
            return
          }

          isConnectionClosed = false
          if (reconnectCount > 0) {
            console.log(`[SSE] 重连成功 (尝试 ${reconnectCount})`)
          }

          if (!hasResolved) {
            hasResolved = true
            resolve(createStreamGenerator())
          }
          else {
            resolveBuffer()
          }
        },

        onmessage: (ev: EventSourceMessage) => {
          if (signal.aborted || !ev.data?.trim())
            return

          try {
            const parsedData = JSON.parse(ev.data)
            const payload = parsedData?.json ?? parsedData

            if (payload?.code && typeof payload.code === 'string') {
              const code = isStandardORPCError(payload.code)
                ? payload.code
                : 'INTERNAL_SERVER_ERROR'

              streamError = new ORPCError(code, {
                message: payload.message || COMMON_ORPC_ERROR_DEFS[code]?.message,
                data: payload.data,
                cause: payload.cause,
              })
              resolveBuffer()
              return
            }

            const actualData = RPCUtils.extractData(parsedData)

            if (RPCUtils.isEndMarker(actualData)) {
              isStreamFinished = true
              resolveBuffer()
              return
            }

            if (actualData !== undefined) {
              buffer.push(actualData)
              resolveBuffer()
            }
          }
          catch {
            buffer.push(ev.data)
            resolveBuffer()
          }
        },

        onerror: (err: any) => {
          if (err?.name === 'AbortError' || streamError)
            return

          reconnectCount++
          if (reconnectCount > MAX_RECONNECTS) {
            console.error(`[SSE] 超过最大重连次数 (${MAX_RECONNECTS})`)
            handleError(new ORPCError('INTERNAL_SERVER_ERROR', {
              message: 'Max reconnection attempts reached',
              cause: err,
            }))
            return
          }

          console.warn(`[SSE] 连接错误,准备重连 (${reconnectCount}/${MAX_RECONNECTS})`)
          isConnectionClosed = true
          resolveBuffer()

          return Math.min(1000 * (2 ** (reconnectCount - 1)), 30000)
        },

        onclose: () => {
          if (signal.aborted || streamError)
            return

          isConnectionClosed = true

          if (!isStreamFinished) {
            handleError(new ORPCError('SERVICE_UNAVAILABLE', {
              message: 'SSE connection closed unexpectedly',
            }))
          }
          else {
            resolveBuffer()
          }
        },
      }).catch(err => handleError(err))
    })
  }

  private async executeRequestWithCustomConfig(
    request: { url: string, method: string, headers: Record<string, string>, body: any },
    options: ClientOptions<Context>,
  ): Promise<unknown> {
    return new Promise<AsyncGenerator<any, void, unknown>>((resolve, reject) => {
      const abortController = new AbortController()
      const signal = options.signal ?? abortController.signal
      let externalAbortHandler: (() => void) | null = null

      let hasResolved = false
      let streamError: Error | null = null
      let isStreamFinished = false
      let isConnectionClosed = false

      const buffer: any[] = []
      let bufferResolver: (() => void) | null = null

      let reconnectCount = 0
      const MAX_RECONNECTS = 0

      const resolveBuffer = () => bufferResolver?.()

      // 清理函数
      const cleanup = () => {
        if (options.signal && externalAbortHandler) {
          options.signal.removeEventListener('abort', externalAbortHandler)
          externalAbortHandler = null
        }
        bufferResolver = null
      }

      async function* createStreamGenerator() {
        try {
          while (true) {
            if (streamError)
              throw streamError

            if (isStreamFinished && buffer.length === 0) {
              break
            }

            if (buffer.length > 0) {
              yield buffer.shift()
            }
            else {
              if (isConnectionClosed && !isStreamFinished) {
                await new Promise<void>(r => setTimeout(r, 100))
                continue
              }

              await new Promise<void>((r) => {
                bufferResolver = r
              })
            }
          }
        }
        finally {
          abortController.abort()
          cleanup()
        }
      }

      const handleError = (error: any) => {
        const orpcError = error instanceof ORPCError
          ? error
          : new ORPCError('INTERNAL_SERVER_ERROR', {
            message: COMMON_ORPC_ERROR_DEFS.INTERNAL_SERVER_ERROR.message,
            cause: error,
          })

        if (!hasResolved) {
          cleanup()
          reject(orpcError)
        }
        else {
          streamError = orpcError
          resolveBuffer()
        }
      }

      // 监听外部 signal
      if (options.signal) {
        externalAbortHandler = () => {
          abortController.abort()
          handleError(new ORPCError('CLIENT_CLOSED_REQUEST', {
            message: COMMON_ORPC_ERROR_DEFS.CLIENT_CLOSED_REQUEST.message,
          }))
        }

        if (options.signal.aborted) {
          externalAbortHandler()
          return
        }
        else {
          options.signal.addEventListener('abort', externalAbortHandler, { once: true })
        }
      }

      fetchEventSource(request.url, {
        method: request.method as any,
        headers: request.headers,
        data: request.body,
        signal,
        openWhenHidden: false,

        onopen: async (res: any) => {
          if (signal.aborted)
            return

          const status = typeof res?.status === 'number' ? res.status : res?.statusCode
          const ok = typeof res?.ok === 'boolean' ? res.ok : (typeof status === 'number' ? status >= 200 && status < 300 : true)

          if (!ok || (typeof status === 'number' && status >= 400)) {
            const err = RPCUtils.extractError({ status, data: res })
              ?? new ORPCError(getErrorCodeFromStatus(status!), {
                message: `SSE ${COMMON_ORPC_ERROR_DEFS[getErrorCodeFromStatus(status!)]?.message ?? 'connection failed'}: ${status}`,
              })
            handleError(err)
            abortController.abort()
            return
          }

          isConnectionClosed = false
          if (reconnectCount > 0) {
            console.log(`[SSE] 重连成功 (尝试 ${reconnectCount})`)
          }

          if (!hasResolved) {
            hasResolved = true
            resolve(createStreamGenerator())
          }
          else {
            resolveBuffer()
          }
        },

        onmessage: (ev: EventSourceMessage) => {
          if (signal.aborted || !ev.data?.trim())
            return

          try {
            const parsedData = JSON.parse(ev.data)
            const payload = parsedData?.json ?? parsedData

            if (payload?.code && typeof payload.code === 'string') {
              const code = isStandardORPCError(payload.code)
                ? payload.code
                : 'INTERNAL_SERVER_ERROR'

              streamError = new ORPCError(code, {
                message: payload.message || COMMON_ORPC_ERROR_DEFS[code]?.message,
                data: payload.data,
                cause: payload.cause,
              })
              resolveBuffer()
              return
            }

            const actualData = RPCUtils.extractData(parsedData)

            if (RPCUtils.isEndMarker(actualData)) {
              isStreamFinished = true
              resolveBuffer()
              return
            }

            if (actualData !== undefined) {
              buffer.push(actualData)
              resolveBuffer()
            }
          }
          catch {
            buffer.push(ev.data)
            resolveBuffer()
          }
        },

        onerror: (err: any) => {
          if (err?.name === 'AbortError' || streamError)
            return

          reconnectCount++
          if (reconnectCount > MAX_RECONNECTS) {
            console.error(`[SSE] 超过最大重连次数 (${MAX_RECONNECTS})`)
            handleError(new ORPCError('INTERNAL_SERVER_ERROR', {
              message: 'Max reconnection attempts reached',
              cause: err,
            }))
            return
          }

          console.warn(`[SSE] 连接错误,准备重连 (${reconnectCount}/${MAX_RECONNECTS})`)
          isConnectionClosed = true
          resolveBuffer()

          return Math.min(1000 * (2 ** (reconnectCount - 1)), 30000)
        },

        onclose: () => {
          if (signal.aborted || streamError)
            return

          isConnectionClosed = true

          if (!isStreamFinished) {
            handleError(new ORPCError('SERVICE_UNAVAILABLE', {
              message: 'SSE connection closed unexpectedly',
            }))
          }
          else {
            resolveBuffer()
          }
        },
      }).catch(err => handleError(err))
    })
  }
}

// ========== 客户端上下文类型 ==========

interface ClientContext {
  stream?: boolean
  sse?: boolean
}

// ========== 客户端创建函数 ==========

export function createUniAppORPCClient<T extends {}, Context = {}>(
  config: UniAppRPCLinkConfig,
): ContractRouterClient<T, Context> {
  const httpLink = new UniAppHTTPLink<Context>(config)
  const sseLink = new UniAppSSELink<Context>(config)

  const dynamicLink = new DynamicLink<Context>((options) => {
    const ctx = options.context as ClientContext
    return ctx?.stream || ctx?.sse ? sseLink : httpLink
  })

  return createORPCClient(dynamicLink)
}

export function createUniAppHTTPClient<T extends {}, Context = {}>(
  config: UniAppRPCLinkConfig,
): ContractRouterClient<T, Context> {
  const link = new UniAppHTTPLink<Context>(config)
  return createORPCClient(link)
}

export function createUniAppSSEClient<T extends {}, Context = {}>(
  config: UniAppRPCLinkConfig,
): ContractRouterClient<T, Context> {
  const link = new UniAppSSELink<Context>(config)
  return createORPCClient(link)
}

// ========== 重新导出 ORPC 工具 ==========

export { COMMON_ORPC_ERROR_DEFS, onError, onFinish, onStart, onSuccess }
