import { stripMarkdown } from '../markdown';

describe('stripMarkdown', () => {
  test('empty input', () => {
    expect(stripMarkdown('')).toBe('');
    expect(stripMarkdown(null)).toBe('');
    expect(stripMarkdown(undefined)).toBe('');
  });

  test('non-string input is stringified', () => {
    expect(stripMarkdown(42)).toBe('42');
  });

  test('plain text passes through, whitespace collapsed', () => {
    expect(stripMarkdown('  hello \n\n  world  ')).toBe('hello world');
  });

  test('headings, blockquotes, list markers', () => {
    expect(stripMarkdown('# Title\n## Sub')).toBe('Title Sub');
    expect(stripMarkdown('> quoted\n>also')).toBe('quoted also');
    expect(stripMarkdown('- one\n* two\n+ three')).toBe('one two three');
    expect(stripMarkdown('1. first\n2. second')).toBe('first second');
  });

  test('a hash without a following space is not a heading', () => {
    expect(stripMarkdown('#tag')).toBe('#tag');
  });

  test('emphasis pairs', () => {
    expect(stripMarkdown('**bold** and __bold__')).toBe('bold and bold');
    expect(stripMarkdown('*it* and _it_')).toBe('it and it');
    expect(stripMarkdown('~~gone~~')).toBe('gone');
    expect(stripMarkdown('***both***')).toBe('both');
  });

  test('a lone asterisk leaves the surrounding text alone', () => {
    expect(stripMarkdown('5 * 3 = 15')).toBe('5 * 3 = 15');
  });

  test('links and images keep their text', () => {
    expect(stripMarkdown('see [the post](https://vakana.mg/x)')).toBe('see the post');
    expect(stripMarkdown('![a bead](file:///x.png) here')).toBe('a bead here');
    expect(stripMarkdown('![](file:///x.png)')).toBe('');
  });

  test('inline code and fenced blocks keep their contents', () => {
    expect(stripMarkdown('run `npm test` now')).toBe('run npm test now');
    expect(stripMarkdown('before\n```js\nconst a = 1;\n```\nafter')).toBe(
      'before const a = 1; after'
    );
  });

  test('horizontal rules vanish', () => {
    expect(stripMarkdown('above\n\n---\n\nbelow')).toBe('above below');
    expect(stripMarkdown('above\n***\nbelow')).toBe('above below');
  });

  test('a mixed entry', () => {
    const src = [
      '# Morning pages',
      '',
      'Went to **Analakely** with _Rija_ \u2014 see [map](geo:0,0).',
      '',
      '- bought `vakana`',
      '- ~~rain~~ sun',
    ].join('\n');
    expect(stripMarkdown(src)).toBe(
      'Morning pages Went to Analakely with Rija \u2014 see map. bought vakana rain sun'
    );
  });
});
