// Unanchored on purpose: live models sometimes wrap JSON in a fence and then
// append (or prepend) trailing prose outside it despite being told not to.
// Searching for the fence anywhere in the string — rather than requiring it
// to span the entire trimmed text — lets us still extract the JSON in that
// case instead of failing to match at all and passing the raw text (prose
// included) to JSON.parse. Shared by MemoryManager and AgentRunner — both
// parse LLM output that is supposed to be JSON but sometimes isn't cleanly.
const MARKDOWN_FENCE_RE = /```(?:json)?\s*\n?([\s\S]*?)\n?```/;

export function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(MARKDOWN_FENCE_RE);
  return match ? match[1].trim() : trimmed;
}
