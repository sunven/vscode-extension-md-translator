import { strict as assert } from 'assert'
import {
  applyTranslations,
  createTranslationBatches,
  parseMarkdownSegments,
  splitLongMarkdownSegments,
  validateTranslatedMarkdown
} from '../markdownSegments'

describe('markdownSegments', () => {
  it('translates prose while preserving protected Markdown structure', () => {
    const source = [
      '---',
      'title: Keep this metadata',
      '---',
      '# Install `file-converter`',
      '',
      'Visit [the docs](https://example.test/docs) and ![Architecture diagram](./diagram.png).',
      '',
      '| Name | Description |',
      '| --- | --- |',
      '| CLI | Run `npm test` safely |',
      '',
      '```ts',
      'const text = "Do not translate this";',
      '```',
      '',
      '> Review the diff before replacing the source.',
      '- Install the extension from the marketplace.'
    ].join('\n')

    const parsed = parseMarkdownSegments(source)
    assert.ok(parsed.segments.length > 0)
    assert.equal(parsed.segments.some(segment => segment.text.includes('npm test')), false)
    assert.equal(parsed.segments.some(segment => segment.text.includes('https://example.test/docs')), false)

    const translations = new Map(parsed.segments.map(segment => [segment.id, `译文-${segment.id}`]))
    const translated = applyTranslations(parsed, translations)
    const validation = validateTranslatedMarkdown(source, translated)

    assert.equal(validation.valid, true, validation.errors.join('\n'))
    assert.ok(translated.includes('---\ntitle: Keep this metadata\n---'))
    assert.ok(translated.includes('```ts\nconst text = "Do not translate this";\n```'))
    assert.ok(translated.includes('](https://example.test/docs)'))
    assert.ok(translated.includes('](./diagram.png)'))
    assert.ok(translated.includes('| --- | --- |'))
  })

  it('keeps punctuation-only and non-English text out of translation segments', () => {
    const parsed = parseMarkdownSegments('# 你好，世界！\n\n---\n\n')

    assert.deepEqual(parsed.segments, [])
    assert.equal(applyTranslations(parsed, new Map()), '# 你好，世界！\n\n---\n\n')
  })

  it('does not treat an unterminated leading horizontal rule as Front Matter', () => {
    const parsed = parseMarkdownSegments('---\n\nTranslate this paragraph.\n')

    assert.equal(parsed.segments.length, 1)
    assert.equal(parsed.segments[0].text, 'Translate this paragraph.')
  })

  it('splits translation batches by configured source size', () => {
    const segments = [
      { id: 's1', text: '12345' },
      { id: 's2', text: '12345' },
      { id: 's3', text: '12345' }
    ]

    assert.deepEqual(createTranslationBatches(segments, 10), [
      [segments[0], segments[1]],
      [segments[2]]
    ])
  })

  it('allows larger batches for many short segments', () => {
    const segments = Array.from({ length: 240 }, (_, index) => ({
      id: `s${index + 1}`,
      text: 'Short sentence.'
    }))

    assert.equal(createTranslationBatches(segments, 6000).length, 6)
    assert.equal(createTranslationBatches(segments, 6000, 120).length, 2)
    assert.equal(createTranslationBatches(segments, 2000, 120).length, 2)
  })

  it('splits oversized Markdown segments before batching', () => {
    const source = [
      'Intro',
      '',
      'This paragraph stays on one Markdown line and should still be split into bounded translation segments before it reaches the provider.'
    ].join('\n')
    const parsed = splitLongMarkdownSegments(parseMarkdownSegments(source), 40)

    assert.ok(parsed.segments.length > 2)
    assert.ok(parsed.segments.every(segment => segment.text.length <= 40))
    assert.ok(createTranslationBatches(parsed.segments, 40).every(batch => (
      batch.reduce((total, segment) => total + segment.text.length, 0) <= 40
    )))
    assert.equal(
      applyTranslations(parsed, new Map(parsed.segments.map(segment => [segment.id, segment.text]))),
      source
    )
  })

  it('reports validation errors when protected structures change', () => {
    const source = [
      '[Docs](https://example.test/docs)',
      '',
      '```js',
      'console.log("safe")',
      '```'
    ].join('\n')

    const translated = [
      '[文档](https://changed.test/docs)',
      '',
      '```js',
      'console.log("changed")',
      '```'
    ].join('\n')

    const validation = validateTranslatedMarkdown(source, translated)

    assert.equal(validation.valid, false)
    assert.ok(validation.errors.some(error => error.includes('fenced code blocks')))
    assert.ok(validation.errors.some(error => error.includes('link destinations')))
  })
})
