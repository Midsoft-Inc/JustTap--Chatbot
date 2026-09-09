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
export function normalizeDomainQuery(text: string): string {
  let value = stripEmoji(text);

  // Normalize common Hindi/Hinglish service phrases to stable English
  // retrieval terms without changing the user's requested response language.
  const replacements: Array<[RegExp, string]> = [
    [/\blogin\s+(?:kaise|kese|kais[ae])\s+(?:karu|kare|karen|kr\s*\w*)\b/gi, 'how to login'],
    [/\blogin\s+(?:kaise|kese|kais[ae])\b/gi, 'how to login'],
    [/\bsign\s*in\s+(?:kaise|kare|karu|karen)\b/gi, 'how to sign in'],
    [/\blogin\s+karna\s+hai\b/gi, 'need to login'],
    [/\blogin\s+karna\b/gi, 'login'],
    [/\bkaise\s+login\s+(?:karu|kare|karen)\b/gi, 'how to login'],
  ];

  for (const [pattern, replacement] of replacements) {
    value = value.replace(pattern, replacement);
  }

  return value.replace(/\s+/g, ' ').trim();
}

export function isContentless(text: string): boolean {
  const withoutEmoji = stripEmoji(text);
  const withoutPunctuation = withoutEmoji.replace(/[^\p{L}\p{N}]+/gu, '');
  return withoutPunctuation.length === 0;
}
