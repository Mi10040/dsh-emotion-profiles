/**
 * Message helpers for the run collector.
 *
 * The collector reads committed Session events and only ever extracts text:
 * no message is modified, re-appended, or inspected beyond the fields below.
 */

/** Concatenate the text blocks of a message's content. */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/** First non-empty line, bounded — used for the run's goal field. */
export function firstLine(text, max = 200) {
  const value = String(text ?? '').trim()
  if (value === '') return ''
  const line = value.split(/\r?\n/).find((entry) => entry.trim() !== '') ?? ''
  const clean = line.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

/** Count code points (not UTF-16 units) for text-length features. */
export function charCount(text) {
  return Array.from(String(text ?? '')).length
}

/** True when the message came from a human rather than a synthetic injection. */
export function isHumanMessage(message) {
  if (!message || typeof message !== 'object') return false
  const source = message.source
  return Boolean(source && typeof source === 'object' && source.kind === 'user')
}
