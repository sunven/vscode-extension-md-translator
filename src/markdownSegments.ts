import { TranslationClientError, TranslationSegmentInput } from './translationShared'

type MarkdownToken =
  | { kind: 'raw'; text: string }
  | { kind: 'segment'; id: string; original: string }

interface Line {
  content: string
  eol: string
}

export interface ParsedMarkdown {
  tokens: MarkdownToken[]
  segments: TranslationSegmentInput[]
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

interface ParseState {
  nextSegmentNumber: number
}

export function parseMarkdownSegments(source: string): ParsedMarkdown {
  const state: ParseState = { nextSegmentNumber: 1 }
  const tokens: MarkdownToken[] = []
  const lines = splitLines(source)

  let index = 0

  const frontMatterEnd = findFrontMatterEnd(lines)

  if (frontMatterEnd !== -1) {
    while (index <= frontMatterEnd) {
      pushRaw(tokens, lineToText(lines[index]))
      index += 1
    }
  }

  let inFence: { marker: string; size: number } | undefined
  let inHtmlComment = false

  for (; index < lines.length; index += 1) {
    const line = lines[index]

    if (inFence) {
      pushRaw(tokens, lineToText(line))

      if (isClosingFence(line.content, inFence)) {
        inFence = undefined
      }

      continue
    }

    const openingFence = getOpeningFence(line.content)

    if (openingFence) {
      inFence = openingFence
      pushRaw(tokens, lineToText(line))
      continue
    }

    if (inHtmlComment) {
      pushRaw(tokens, lineToText(line))

      if (line.content.includes('-->')) {
        inHtmlComment = false
      }

      continue
    }

    if (line.content.includes('<!--')) {
      pushRaw(tokens, lineToText(line))
      inHtmlComment = !line.content.includes('-->')
      continue
    }

    if (isIndentedCodeLine(line.content) || isRawHtmlLine(line.content) || isTableSeparatorLine(line.content)) {
      pushRaw(tokens, lineToText(line))
      continue
    }

    if (line.content.trim() === '') {
      pushRaw(tokens, lineToText(line))
      continue
    }

    if (isProbablyTableRow(line.content)) {
      pushTableRow(tokens, line.content, state)
      pushRaw(tokens, line.eol)
      continue
    }

    pushLineWithPrefix(tokens, line.content, state)
    pushRaw(tokens, line.eol)
  }

  return {
    tokens,
    segments: collectSegments(tokens)
  }
}

export function splitLongMarkdownSegments(parsed: ParsedMarkdown, maxSegmentChars: number): ParsedMarkdown {
  if (maxSegmentChars <= 0) {
    return parsed
  }

  const tokens: MarkdownToken[] = []

  for (const token of parsed.tokens) {
    if (token.kind === 'raw' || token.original.length <= maxSegmentChars) {
      tokens.push(token)
      continue
    }

    const parts = splitTextByMaxChars(token.original, maxSegmentChars)

    for (let index = 0; index < parts.length; index += 1) {
      tokens.push({
        kind: 'segment',
        id: `${token.id}p${index + 1}`,
        original: parts[index]
      })
    }
  }

  return {
    tokens,
    segments: collectSegments(tokens)
  }
}

export function applyTranslations(parsed: ParsedMarkdown, translations: Map<string, string>): string {
  return parsed.tokens.map(token => {
    if (token.kind === 'raw') {
      return token.text
    }

    const translated = translations.get(token.id)

    if (translated === undefined) {
      throw new TranslationClientError(`Missing translation for segment id: ${token.id}`)
    }

    return translated
  }).join('')
}

export function createTranslationBatches(
  segments: TranslationSegmentInput[],
  maxChunkChars: number,
  maxSegmentCount = 40
): TranslationSegmentInput[][] {
  const batches: TranslationSegmentInput[][] = []
  let currentBatch: TranslationSegmentInput[] = []
  let currentSize = 0

  for (const segment of segments) {
    const segmentSize = segment.text.length

    if (
      currentBatch.length > 0 &&
      (currentSize + segmentSize > maxChunkChars || currentBatch.length >= maxSegmentCount)
    ) {
      batches.push(currentBatch)
      currentBatch = []
      currentSize = 0
    }

    currentBatch.push(segment)
    currentSize += segmentSize
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch)
  }

  return batches
}

export function validateTranslatedMarkdown(original: string, translated: string): ValidationResult {
  const errors: string[] = []

  if (!translated.trim()) {
    errors.push('Translated Markdown is empty.')
  }

  if (translated === original) {
    errors.push('Translated Markdown is identical to the source.')
  }

  compareExact('Front Matter', extractFrontMatter(original), extractFrontMatter(translated), errors)
  compareJson('fenced code blocks', extractFencedCodeBlocks(original), extractFencedCodeBlocks(translated), errors)
  compareJson('link destinations', extractLinkDestinations(original, false), extractLinkDestinations(translated, false), errors)
  compareJson('image destinations', extractLinkDestinations(original, true), extractLinkDestinations(translated, true), errors)
  compareJson('table column counts', extractTableColumnCounts(original), extractTableColumnCounts(translated), errors)

  return {
    valid: errors.length === 0,
    errors
  }
}

function pushLineWithPrefix(tokens: MarkdownToken[], content: string, state: ParseState): void {
  const heading = content.match(/^(\s{0,3}#{1,6}\s+)(.*?)(\s+#*\s*)$/)

  if (heading) {
    pushRaw(tokens, heading[1])
    pushInlineTokens(tokens, heading[2], state)
    pushRaw(tokens, heading[3])
    return
  }

  const listItem = content.match(/^(\s*(?:[-+*]|\d+[.)])\s+)(.*)$/)

  if (listItem) {
    pushRaw(tokens, listItem[1])
    pushInlineTokens(tokens, listItem[2], state)
    return
  }

  const blockquote = content.match(/^(\s*>+\s?)(.*)$/)

  if (blockquote) {
    pushRaw(tokens, blockquote[1])
    pushInlineTokens(tokens, blockquote[2], state)
    return
  }

  pushInlineTokens(tokens, content, state)
}

function pushTableRow(tokens: MarkdownToken[], content: string, state: ParseState): void {
  const parts = splitUnescapedPipes(content)

  for (let index = 0; index < parts.length; index += 1) {
    const cell = parts[index]
    const whitespace = cell.match(/^(\s*)(.*?)(\s*)$/)

    if (!whitespace || whitespace[2] === '') {
      pushRaw(tokens, cell)
    } else {
      pushRaw(tokens, whitespace[1])
      pushInlineTokens(tokens, whitespace[2], state)
      pushRaw(tokens, whitespace[3])
    }

    if (index < parts.length - 1) {
      pushRaw(tokens, '|')
    }
  }
}

function pushInlineTokens(tokens: MarkdownToken[], text: string, state: ParseState, depth = 0): void {
  if (depth > 4) {
    pushSegment(tokens, text, state)
    return
  }

  let cursor = 0
  let buffer = ''

  const flushBuffer = () => {
    if (buffer) {
      pushSegment(tokens, buffer, state)
      buffer = ''
    }
  }

  while (cursor < text.length) {
    const rest = text.slice(cursor)
    const codeSpan = rest.match(/^(`+)([\s\S]*?)\1/)

    if (codeSpan) {
      flushBuffer()
      pushRaw(tokens, codeSpan[0])
      cursor += codeSpan[0].length
      continue
    }

    const autolink = rest.match(/^<https?:\/\/[^>\s]+>/i)

    if (autolink) {
      flushBuffer()
      pushRaw(tokens, autolink[0])
      cursor += autolink[0].length
      continue
    }

    const rawUrl = rest.match(/^https?:\/\/[^\s<>)\]]+/i)

    if (rawUrl) {
      flushBuffer()
      pushRaw(tokens, rawUrl[0])
      cursor += rawUrl[0].length
      continue
    }

    const imageLink = parseMarkdownLink(text, cursor, true)

    if (imageLink) {
      flushBuffer()
      pushRaw(tokens, '![')
      pushInlineTokens(tokens, imageLink.label, state, depth + 1)
      pushRaw(tokens, imageLink.suffix)
      cursor = imageLink.end
      continue
    }

    const link = parseMarkdownLink(text, cursor, false)

    if (link) {
      flushBuffer()
      pushRaw(tokens, '[')
      pushInlineTokens(tokens, link.label, state, depth + 1)
      pushRaw(tokens, link.suffix)
      cursor = link.end
      continue
    }

    buffer += text[cursor]
    cursor += 1
  }

  flushBuffer()
}

function pushSegment(tokens: MarkdownToken[], text: string, state: ParseState): void {
  if (!/[A-Za-z]/.test(text)) {
    pushRaw(tokens, text)
    return
  }

  const id = `s${state.nextSegmentNumber}`
  state.nextSegmentNumber += 1
  tokens.push({ kind: 'segment', id, original: text })
}

function collectSegments(tokens: MarkdownToken[]): TranslationSegmentInput[] {
  return tokens
    .filter((token): token is Extract<MarkdownToken, { kind: 'segment' }> => token.kind === 'segment')
    .map(token => ({ id: token.id, text: token.original }))
}

function splitTextByMaxChars(text: string, maxChars: number): string[] {
  const parts: string[] = []
  let start = 0

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length)

    if (end < text.length) {
      end = findReadableSplitPoint(text, start, end, maxChars)
    }

    parts.push(text.slice(start, end))
    start = end
  }

  return parts
}

function findReadableSplitPoint(text: string, start: number, preferredEnd: number, maxChars: number): number {
  const minimumUsefulSize = Math.floor(maxChars * 0.6)

  for (const delimiter of ['. ', '! ', '? ', '; ', ': ', ', ', ' ']) {
    const delimiterIndex = text.lastIndexOf(delimiter, preferredEnd)
    const end = delimiterIndex === -1 ? -1 : delimiterIndex + delimiter.length

    if (end > start + minimumUsefulSize && end <= preferredEnd) {
      return end
    }
  }

  return preferredEnd
}

function pushRaw(tokens: MarkdownToken[], text: string): void {
  if (!text) {
    return
  }

  const lastToken = tokens[tokens.length - 1]

  if (lastToken?.kind === 'raw') {
    lastToken.text += text
    return
  }

  tokens.push({ kind: 'raw', text })
}

function parseMarkdownLink(text: string, start: number, image: boolean): { label: string; suffix: string; end: number } | undefined {
  if (image && !text.startsWith('![', start)) {
    return undefined
  }

  if (!image && !text.startsWith('[', start)) {
    return undefined
  }

  const labelStart = start + (image ? 2 : 1)
  const labelEnd = findUnescaped(text, ']', labelStart)

  if (labelEnd === -1 || text[labelEnd + 1] !== '(') {
    return undefined
  }

  const destinationEnd = findClosingParen(text, labelEnd + 2)

  if (destinationEnd === -1) {
    return undefined
  }

  return {
    label: text.slice(labelStart, labelEnd),
    suffix: text.slice(labelEnd, destinationEnd + 1),
    end: destinationEnd + 1
  }
}

function findUnescaped(text: string, character: string, start: number): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === character && text[index - 1] !== '\\') {
      return index
    }
  }

  return -1
}

function findClosingParen(text: string, start: number): number {
  let depth = 0

  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }

    if (text[index] === '(') {
      depth += 1
    }

    if (text[index] === ')') {
      if (depth === 0) {
        return index
      }

      depth -= 1
    }
  }

  return -1
}

function splitLines(text: string): Line[] {
  if (!text) {
    return []
  }

  const lines: Line[] = []
  let start = 0

  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\n' && text[index] !== '\r') {
      continue
    }

    const eol = text[index] === '\r' && text[index + 1] === '\n' ? '\r\n' : text[index]
    lines.push({
      content: text.slice(start, index),
      eol
    })

    if (eol === '\r\n') {
      index += 1
    }

    start = index + 1
  }

  if (start < text.length) {
    lines.push({
      content: text.slice(start),
      eol: ''
    })
  }

  return lines
}

function lineToText(line: Line): string {
  return `${line.content}${line.eol}`
}

function findFrontMatterEnd(lines: Line[]): number {
  if (lines[0]?.content !== '---') {
    return -1
  }

  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].content === '---' || lines[index].content === '...') {
      return index
    }
  }

  return -1
}

function getOpeningFence(content: string): { marker: string; size: number } | undefined {
  const match = content.match(/^ {0,3}(`{3,}|~{3,})/)
  return match ? { marker: match[1][0], size: match[1].length } : undefined
}

function isClosingFence(content: string, fence: { marker: string; size: number }): boolean {
  const escapedMarker = fence.marker === '`' ? '`' : '~'
  const pattern = new RegExp(`^ {0,3}${escapedMarker}{${fence.size},}\\s*$`)
  return pattern.test(content)
}

function isIndentedCodeLine(content: string): boolean {
  return /^( {4,}|\t)/.test(content)
}

function isRawHtmlLine(content: string): boolean {
  return /^ {0,3}<\/?[A-Za-z][^>]*>\s*$/.test(content)
}

function isTableSeparatorLine(content: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(content)
}

function isProbablyTableRow(content: string): boolean {
  return countUnescapedPipes(content) > 0
}

function splitUnescapedPipes(content: string): string[] {
  const parts: string[] = []
  let current = ''

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\\') {
      current += content[index]

      if (index + 1 < content.length) {
        current += content[index + 1]
        index += 1
      }

      continue
    }

    if (content[index] === '|') {
      parts.push(current)
      current = ''
      continue
    }

    current += content[index]
  }

  parts.push(current)
  return parts
}

function countUnescapedPipes(content: string): number {
  return splitUnescapedPipes(content).length - 1
}

function extractFrontMatter(text: string): string | undefined {
  const lines = splitLines(text)
  const frontMatterEnd = findFrontMatterEnd(lines)

  if (frontMatterEnd === -1) {
    return undefined
  }

  let frontMatter = ''

  for (let index = 0; index <= frontMatterEnd; index += 1) {
    frontMatter += lineToText(lines[index])
  }

  return frontMatter
}

function extractFencedCodeBlocks(text: string): string[] {
  const blocks: string[] = []
  const lines = splitLines(text)
  let current = ''
  let fence: { marker: string; size: number } | undefined

  for (const line of lines) {
    const openingFence = !fence ? getOpeningFence(line.content) : undefined

    if (openingFence) {
      fence = openingFence
      current = lineToText(line)
      continue
    }

    if (fence) {
      current += lineToText(line)

      if (isClosingFence(line.content, fence)) {
        blocks.push(current)
        current = ''
        fence = undefined
      }
    }
  }

  return blocks
}

function extractLinkDestinations(text: string, imagesOnly: boolean): string[] {
  const destinations: string[] = []
  const pattern = /(!?)\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const isImage = match[1] === '!'

    if (isImage === imagesOnly) {
      destinations.push(match[2])
    }
  }

  return destinations
}

function extractTableColumnCounts(text: string): number[] {
  const counts: number[] = []
  const lines = splitLines(text)
  let fence: { marker: string; size: number } | undefined

  for (const line of lines) {
    const openingFence = !fence ? getOpeningFence(line.content) : undefined

    if (openingFence) {
      fence = openingFence
      continue
    }

    if (fence) {
      if (isClosingFence(line.content, fence)) {
        fence = undefined
      }

      continue
    }

    if (isProbablyTableRow(line.content)) {
      counts.push(splitUnescapedPipes(line.content).length)
    }
  }

  return counts
}

function compareExact(label: string, original: string | undefined, translated: string | undefined, errors: string[]): void {
  if (original !== translated) {
    errors.push(`${label} changed during translation.`)
  }
}

function compareJson(label: string, original: unknown, translated: unknown, errors: string[]): void {
  if (JSON.stringify(original) !== JSON.stringify(translated)) {
    errors.push(`${label} changed during translation.`)
  }
}
