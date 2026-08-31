// src/langchain/textSignal.ts
//
// Small pre-processing step run before language detection / the semantic
// chain. Two jobs:
//
// 1. Detect messages that carry no real question at all (a bare emoji,
//    a string of emoji, or just punctuation/whitespace). These should
//    never reach the grounded-answer LLM call: there's nothing to
//    ground an answer in, so today the model just improvises a plausible
//    -sounding reply -- which is exactly the hallucination pattern seen
//    on the login question. The orchestrator uses this to route such
//    messages straight to a safe acknowledgement instead.
//
// 2. Strip emoji out of the text that actually gets sent to
//    normalization/translation/the LLM prompts, so stray emoji
//    characters can't (a) interfere with the regex/script-based
//    language detector, or (b) sit inside the prompt as unexplained
//    tokens the model might try to "interpret" into an answer. The
//    original raw message (emoji included) is still what's stored and
//    shown back to the customer -- only the internal processing copy is
//    cleaned.

// Broad emoji ranges (pictographs, symbols, transport, flags, emoji
// presentation modifiers, ZWJ, skin tone modifiers, dingbats).
const EMOJI_PATTERN =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}\u{1F1E6}-\u{1F1FF}]/gu;

export function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

// True for messages that, once emoji and punctuation are removed, carry
// no actual words -- e.g. "🙏", "😀😀", "!!", "👍🏽".
export function isContentless(text: string): boolean {
  const withoutEmoji = stripEmoji(text);
  const withoutPunctuation = withoutEmoji.replace(/[^\p{L}\p{N}]+/gu, '');
  return withoutPunctuation.length === 0;
}
