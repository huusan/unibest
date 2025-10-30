/**
 * Represents a message sent in an event stream
 */
export interface EventSourceMessage {
  id: string
  event: string
  data: string
  retry?: number
}

/**
 * Converts a ReadableStream into a callback pattern.
 */
export async function getBytes(stream: ReadableStream<Uint8Array>, onChunk: (arr: Uint8Array) => void) {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break
      onChunk(value)
    }
  }
  finally {
    reader.releaseLock()
  }
}

enum ControlChars {
  NewLine = 10,
  CarriageReturn = 13,
  Space = 32,
  Colon = 58,
}

/**
 * Parses byte chunks into EventSource line buffers.
 */
export function getLines(onLine: (line: Uint8Array, fieldLength: number) => void) {
  let buffer: Uint8Array | undefined
  let position = 0
  let fieldLength = -1
  let discardTrailingNewline = false

  return function onChunk(arr: Uint8Array) {
    if (buffer === undefined) {
      buffer = arr
      position = 0
      fieldLength = -1
    }
    else {
      // 使用更高效的合并方式
      const newBuffer = new Uint8Array(buffer.length + arr.length)
      newBuffer.set(buffer)
      newBuffer.set(arr, buffer.length)
      buffer = newBuffer
    }

    const bufLength = buffer.length
    let lineStart = 0

    while (position < bufLength) {
      if (discardTrailingNewline) {
        if (buffer[position] === ControlChars.NewLine) {
          lineStart = ++position
        }
        discardTrailingNewline = false
      }

      let lineEnd = -1
      // 优化：减少重复读取 buffer[position]
      for (; position < bufLength; ++position) {
        const byte = buffer[position]

        if (byte === ControlChars.Colon && fieldLength === -1) {
          fieldLength = position - lineStart
        }
        else if (byte === ControlChars.CarriageReturn) {
          discardTrailingNewline = true
          lineEnd = position
          break
        }
        else if (byte === ControlChars.NewLine) {
          lineEnd = position
          break
        }
      }

      if (lineEnd === -1)
        break

      onLine(buffer.subarray(lineStart, lineEnd), fieldLength)
      lineStart = ++position
      fieldLength = -1
    }

    if (lineStart === bufLength) {
      buffer = undefined
    }
    else if (lineStart !== 0) {
      buffer = buffer.subarray(lineStart)
      position -= lineStart
    }
  }
}

/**
 * Parses line buffers into EventSourceMessages.
 */
export function getMessages(
  onMessage?: (msg: EventSourceMessage) => void,
  onId?: (id: string) => void,
  onRetry?: (retry: number) => void,
) {
  let message = newMessage()
  // 复用 TextDecoder 实例以提升性能
  let decoder: TextDecoder | undefined

  try {
    decoder = new TextDecoder('utf-8', { fatal: false })
  }
  catch {
    // 小程序环境降级方案
    decoder = undefined
  }

  const decode = decoder
    ? (arr: Uint8Array) => decoder!.decode(arr)
    : (arr: Uint8Array) => {
        let result = ''
        for (let i = 0; i < arr.length; i++) {
          result += String.fromCharCode(arr[i])
        }
        return result
      }

  return function onLine(line: Uint8Array, fieldLength: number) {
    if (line.length === 0) {
      onMessage?.(message)
      message = newMessage()
      return
    }

    if (fieldLength <= 0)
      return

    const field = decode(line.subarray(0, fieldLength))

    // 优化：边界检查并提前计算偏移
    const valueStart = fieldLength + (line[fieldLength + 1] === ControlChars.Space ? 2 : 1)
    if (valueStart >= line.length)
      return

    const value = decode(line.subarray(valueStart))

    if (field === 'data') {
      message.data = message.data ? `${message.data}\n${value}` : value
    }
    else if (field === 'event') {
      message.event = value
    }
    else if (field === 'id') {
      message.id = value
      onId?.(value)
    }
    else if (field === 'retry') {
      const retry = Number.parseInt(value, 10)
      if (!Number.isNaN(retry)) {
        message.retry = retry
        onRetry?.(retry)
      }
    }
  }
}

function newMessage(): EventSourceMessage {
  return {
    data: '',
    event: '',
    id: '',
    retry: undefined,
  }
}
