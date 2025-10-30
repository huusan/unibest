import type { EventSourceMessage } from './parse.js'
import { getLines, getMessages } from './parse.js'

export const EventStreamContentType = 'text/event-stream'

const DefaultRetryInterval = 1000
const LastEventId = 'last-event-id'

export interface FetchEventSourceInit extends RequestInit {
  headers?: Record<string, string>
  onopen?: (response: UniNamespace.RequestSuccessCallbackResult) => Promise<void>
  onmessage?: (ev: EventSourceMessage) => void
  onclose?: () => void
  onerror?: (err: any) => number | null | undefined | void
  openWhenHidden?: boolean
  fetch?: any
  data?: UniNamespace.RequestOptions['data']
  method: UniNamespace.RequestOptions['method']
  enableRetry?: boolean // 新增：是否启用重试
}

export function fetchEventSource(
  input: RequestInfo,
  {
    signal: inputSignal,
    headers: inputHeaders,
    onopen: inputOnOpen,
    onmessage,
    onclose,
    onerror,
    openWhenHidden,
    fetch: inputFetch,
    enableRetry = false, // 默认关闭重试
    ...rest
  }: FetchEventSourceInit,
) {
  return new Promise<void>((resolve, reject) => {
    const headers = { ...inputHeaders }
    let requestTask: UniNamespace.RequestTask | null = null
    let isDisposed = false
    let retryInterval = DefaultRetryInterval
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    let hasOpenedOnce = false
    let isAborting = false

    const onVisibilityChange = () => {
      document.hidden ? requestTask?.abort() : create()
    }

    const onAppShow = () => create()
    const onAppHide = () => requestTask?.abort()

    if (!openWhenHidden) {
      // #ifdef H5
      document.addEventListener('visibilitychange', onVisibilityChange)
      // #endif
      // #ifndef H5
      uni.onAppShow(onAppShow)
      uni.onAppHide(onAppHide)
      // #endif
    }

    const dispose = () => {
      if (isDisposed)
        return
      isDisposed = true
      isAborting = true

      // #ifdef H5
      if (!openWhenHidden)
        document.removeEventListener('visibilitychange', onVisibilityChange)
      // #endif
      // #ifndef H5
      if (!openWhenHidden) {
        uni.offAppShow(onAppShow)
        uni.offAppHide(onAppHide)
      }
      // #endif

      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }

      if (requestTask) {
        try {
          requestTask.abort()
        }
        catch {}
        requestTask = null
      }
    }

    inputSignal?.addEventListener('abort', () => {
      isAborting = true
      dispose()
      resolve()
    })

    const fetchFn = inputFetch ?? uni.request
    const onopen = inputOnOpen ?? defaultOnOpen

    const onChunk = getLines(
      getMessages(
        (msg) => {
          onmessage?.(msg)
        },
        (id) => {
          id ? (headers[LastEventId] = id) : delete headers[LastEventId]
        },
        (retry) => {
          retryInterval = retry
        },
      ),
    )

    function create() {
      if (isDisposed || inputSignal?.aborted)
        return

      const _url = typeof input === 'string' ? input : input.url

      let isHeadersReceived = false

      const handleHeadersReceived = async (res: any) => {
        if (isDisposed || isAborting)
          return

        isHeadersReceived = true

        try {
          await onopen(res)
          hasOpenedOnce = true
        }
        catch (error) {
          handleError(error)
        }
      }

      const handleChunkReceived = (res: { data: ArrayBuffer | Uint8Array }) => {
        if (isDisposed || isAborting)
          return

        onChunk(res.data instanceof ArrayBuffer ? new Uint8Array(res.data) : res.data)
      }

      requestTask = fetchFn({
        url: _url,
        ...rest,
        header: headers,
        enableChunked: true,
        responseType: 'arraybuffer',

        success(res: any) {
          if (res?.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            !isDisposed && handleError(new Error(`HTTP Error: ${res.statusCode}`))
          }
        },

        fail(err: any) {
          !isDisposed && handleError(new Error(err.errMsg || 'Request failed'))
        },

        complete() {
          if (isDisposed || isAborting) {
            return
          }

          // 默认不重试，除非显式启用
          const shouldRetry = enableRetry && hasOpenedOnce && !inputSignal?.aborted && isHeadersReceived

          if (shouldRetry) {
            handleError(new Error('Connection closed unexpectedly'))
            return
          }

          onclose?.()
          dispose()
          resolve()
        },
      })

      // #ifdef MP-WEIXIN || MP-ALIPAY || MP-BAIDU || MP-TOUTIAO || MP-QQ || MP-KUAISHOU || MP-LARK || MP-JD
      const task = requestTask as any
      if (task.onHeadersReceived) {
        task.onHeadersReceived(handleHeadersReceived)
      }

      if (task.onChunkReceived) {
        task.onChunkReceived(handleChunkReceived)
      }
      // #endif
    }

    function handleError(err: any) {
      if (isDisposed || inputSignal?.aborted || isAborting)
        return

      // 如果未启用重试，直接拒绝
      if (!enableRetry) {
        dispose()
        reject(err)
        return
      }

      let interval: number | null | undefined
      try {
        const result = onerror?.(err)
        interval = (typeof result === 'number' && !Number.isNaN(result)) ? result : retryInterval
      }
      catch (innerErr) {
        dispose()
        reject(innerErr)
        return
      }

      if (interval === null) {
        dispose()
        reject(err)
        return
      }

      if (requestTask) {
        try {
          requestTask.abort()
        }
        catch {}
        requestTask = null
      }

      if (retryTimer)
        clearTimeout(retryTimer)

      retryTimer = setTimeout(() => {
        retryTimer = null
        create()
      }, interval)
    }

    create()
  })
}

function defaultOnOpen(response: UniNamespace.RequestSuccessCallbackResult) {
  const contentType = response.header?.['content-type'] || response.header?.['Content-Type']
  if (contentType && !contentType.includes(EventStreamContentType)) {
    throw new Error(
      `Expected content-type to be ${EventStreamContentType}, but got "${contentType}"`,
    )
  }
}
