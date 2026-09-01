import { describe, it, expect } from 'vitest';
import { stripMarkdownFence } from '../src/fence-parser';

describe('stripMarkdownFence', () => {
  it('strips a fence that spans the whole trimmed string', () => {
    const input = '```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('strips a fence with trailing prose after the closing fence', () => {
    const input = '```json\n{"a":1}\n```\n\n**Note:** I omitted extra fields.';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('strips a fence with leading prose before the opening fence', () => {
    const input = 'Here is the JSON:\n```json\n{"a":1}\n```';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });

  it('returns the trimmed text unchanged when no fence is present', () => {
    const input = '  {"a":1}  ';
    expect(stripMarkdownFence(input)).toBe('{"a":1}');
  });
});
