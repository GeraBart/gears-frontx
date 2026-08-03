// @cpt-algo:cpt-frontx-algo-template-manifest-validate-content-self-containment:p2
import { describe, it, expect } from 'vitest';
import { parseJsonc } from '../manifest/parse-jsonc';

describe('parseJsonc', () => {
  it('parses a tsconfig with line comments the same as without them', () => {
    const withComments = `{
      // this is the base config
      "compilerOptions": {
        "baseUrl": ".", // resolve relative to this file
        "strict": true
      }
    }`;

    const result = parseJsonc(withComments);

    expect(result).toEqual({ compilerOptions: { baseUrl: '.', strict: true } });
  });

  it('parses a tsconfig with block comments the same as without them', () => {
    const withComments = `{
      /* leading block comment */
      "compilerOptions": {
        "outDir": /* inline */ "./dist"
      }
      /* trailing block comment */
    }`;

    const result = parseJsonc(withComments);

    expect(result).toEqual({ compilerOptions: { outDir: './dist' } });
  });

  it('parses a tsconfig with trailing commas the same as without them', () => {
    const withTrailingCommas = `{
      "include": ["src/**/*",],
      "compilerOptions": {
        "strict": true,
      },
    }`;

    const result = parseJsonc(withTrailingCommas);

    expect(result).toEqual({ include: ['src/**/*'], compilerOptions: { strict: true } });
  });

  it('parses a trailing comma that is separated from its closing bracket by a comment', () => {
    // The trailing-comma pass runs AFTER comment-stripping specifically so this
    // shape resolves - a comma followed by a comment then `]` is still trailing.
    const value = `{
      "include": [
        "src/**/*", // last entry
      ]
    }`;

    const result = parseJsonc(value);

    expect(result).toEqual({ include: ['src/**/*'] });
  });

  it('leaves a `//` inside a string value untouched rather than treating it as a comment', () => {
    const value = `{ "extends": "https://example.com/tsconfig.json" }`;

    const result = parseJsonc(value);

    expect(result).toEqual({ extends: 'https://example.com/tsconfig.json' });
  });

  it('leaves a `/*` inside a string value untouched rather than treating it as a comment opener', () => {
    const value = `{ "description": "a /* not a comment */ literal string" }`;

    const result = parseJsonc(value);

    expect(result).toEqual({ description: 'a /* not a comment */ literal string' });
  });

  it('leaves an escaped quote inside a string untouched while comment-stripping', () => {
    const value = `{ "note": "she said \\"// not a comment\\" here" }`;

    const result = parseJsonc(value);

    expect(result).toEqual({ note: 'she said "// not a comment" here' });
  });

  it('leaves a comma at the end of a string value untouched rather than treating it as trailing', () => {
    const value = `{ "note": "a, b" }`;

    const result = parseJsonc(value);

    expect(result).toEqual({ note: 'a, b' });
  });

  it('throws on content that is genuinely malformed, even allowing comments and trailing commas', () => {
    const malformed = `{ "compilerOptions": { "strict": true, `; // missing closing braces

    expect(() => parseJsonc(malformed)).toThrow();
  });
});
