export type SseMessage = {
  event: string
  data: string
  id?: string
  retry?: number
}

function parseSseBlock(rawBlock: string): SseMessage | null {
  const lines = rawBlock.split("\n")
  let event = "message"
  let id: string | undefined
  let retry: number | undefined
  const dataLines: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (!line || line.startsWith(":")) {
      continue
    }

    const separator = line.indexOf(":")
    const field = separator === -1 ? line : line.slice(0, separator)
    const value = separator === -1 ? "" : line.slice(separator + 1).trimStart()

    if (field === "event") {
      event = value || "message"
      continue
    }
    if (field === "data") {
      dataLines.push(value)
      continue
    }
    if (field === "id") {
      id = value
      continue
    }
    if (field === "retry") {
      const parsedRetry = Number(value)
      if (Number.isFinite(parsedRetry) && parsedRetry >= 0) {
        retry = Math.floor(parsedRetry)
      }
    }
  }

  if (dataLines.length === 0 && !id) {
    return null
  }

  return {
    event,
    data: dataLines.join("\n"),
    id,
    retry,
  }
}

export async function* readSseStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SseMessage, void, void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }

      buffer += decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, "\n")

      let delimiterIndex = buffer.indexOf("\n\n")
      while (delimiterIndex !== -1) {
        const block = buffer.slice(0, delimiterIndex)
        buffer = buffer.slice(delimiterIndex + 2)
        const parsed = parseSseBlock(block)
        if (parsed) {
          yield parsed
        }
        delimiterIndex = buffer.indexOf("\n\n")
      }
    }

    const finalChunk = decoder.decode()
    if (finalChunk) {
      buffer += finalChunk
      buffer = buffer.replace(/\r\n/g, "\n")
    }

    const trailing = buffer.trim()
    if (trailing) {
      const parsed = parseSseBlock(trailing)
      if (parsed) {
        yield parsed
      }
    }
  } finally {
    reader.releaseLock()
  }
}
