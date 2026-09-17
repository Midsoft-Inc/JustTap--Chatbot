
import { generate } from '../services/huggingface.js';
import { SearchHit } from '../models/types.js';

export type GroundedAnswerInput = {
  message: string;
  normalizedMessage: string;
  language: string;
  intent: string;
  category: string;
  hits: SearchHit[];
  topScore: number;
  minRelevanceScore: number;
};

export async function runAnswerChain(input: GroundedAnswerInput): Promise<string> {
  const strongMatch =
    input.hits.length > 0 &&
    input.topScore >= input.minRelevanceScore;

  // Return predefined KB answers directly.
  // This preserves their exact structure and avoids LLM paraphrasing.
  const predefinedAnswerIds = new Set([
    'svc_overview_001',
  ]);

  if (
    strongMatch &&
    input.hits[0]?.id &&
    predefinedAnswerIds.has(input.hits[0].id)
  ) {
    return input.hits[0].answer;
  }

  if (strongMatch) {
    const context = input.hits
      .map(
        (hit, index) =>
          `[${index + 1}] intent=${hit.intent}; category=${hit.category}; service=${hit.sub_service ?? ''}; Q=${hit.question}; A=${hit.answer}`
      )
      .join('\n');

  const prompt = `
Detected language: ${input.language}

User intent: ${input.intent}

User category: ${input.category}

Original user question:

${input.message}

Normalized English query:

${input.normalizedMessage}

Knowledge context:

${context}

Answer the user using ONLY the supplied knowledge context.

Important:

- Do not invent information.
- Use only information supported by the supplied knowledge context.
- Do not introduce unrelated services, categories, examples, details, or assumptions.
- Do not add information from general knowledge.
- Do not omit relevant information from the supplied knowledge context.
- Do not change the meaning of the supplied knowledge context.
- Do not say that a service is unavailable unless the knowledge context explicitly states that it is unavailable.

- Answer entirely in the requested response language.
- For Hindi responses, write the complete answer in Hindi script.
- For Marathi responses, write the complete answer in Marathi script.
- For English responses, write the complete answer in English.
- Do not leave unnecessary English words inside Hindi or Marathi responses.
- Proper nouns that have no suitable translation may remain unchanged.
- The app name "JustTap" must remain unchanged.

- Keep the answer concise but complete.
- Use a clear and readable structure.
- Do not use Markdown bold (**text**).
- Do not use Markdown italic (*text*).
- Do not use Markdown heading syntax (#, ##, ###).
- Do not use separator lines such as ====, ----, or ****.

- For a complete services overview:
  - Start with:
    🌟 JustTap Services Overview
  - Use a short introductory sentence.
  - Use "-" for category names.
  - Use numbered lists for services.
  - Keep one blank line between categories.
  - Include all relevant categories and services from the knowledge context.
  - Do not add booking, pricing, cancellation, or other information unless the user explicitly asks for it.

- For a specific service:
  - Answer only about that service.
  - Do not append the complete services overview.

- For a booking request:
  - Answer only the booking-related information supported by the knowledge context.
  - Do not append the services overview.

- Preserve the exact service names and categories from the knowledge context.
- Do not invent, rename, merge, or remove services.
- Use "-" for category bullets.
- Use numbered lists for services inside a category.
- Keep one blank line between categories.

- If the user asks for a specific category, provide only that category and its supported services.
- If the user asks for a specific service, answer only about that service.
- If the user asks a booking question, answer only the booking-related information supported by the knowledge context.
- Do not append the complete JustTap Services Overview to a specific-service or booking response.

- If the user asks for a services overview, provide all relevant categories and their complete service lists from the knowledge context.
- Do not use "..." when the knowledge context contains the complete list.

- For the JustTap Services Overview, write:
  🌟 JustTap Services Overview

- The 🌟 emoji must appear before the heading.
- Do not add ** around the heading.
- Do not add any separator below the heading.
- Preserve any other emoji that is explicitly present in the knowledge context.

- If the user asks about a specific category, provide only that category and its supported services.
- If the user asks about a specific service, answer only with information supported by the knowledge context.

- If the user asks how to do something, provide the supported instructions as numbered steps.
- If the user asks about a problem, use these sections only when supported by the knowledge context:
  **Problem**
  **Relevant**

`.trim();

    return generate(prompt, input.language);
  }

  // No sufficiently specific KB record. Use a deterministic safe response
  // instead of an LLM-generated fallback. This prevents unsupported topics
  // (especially login/account access) from producing variable or invented
  // steps, and makes the response safe to cache across devices.
  //
  // GROUNDING NOTE: this list used to only cover 5 known topics (find/
  // book/cancel/reschedule/providers) and left every other topic --
  // including login/account access, which the KB has no records for at
  // all -- with no scripted guardrail. That gap is exactly what produced
  // two different, partly invented answers (including a fabricated
  // "two-factor authentication" step) to the same "how to login" question.
  // The rule below is now restrictive by default: for anything not on
  // this specific list, the model must say it doesn't have exact
  // information rather than describe steps it has no source for.
  const safeFallbacks: Record<string, string> = {
    en: "I don't have exact information about that JustTap topic yet. The JustTap support team can help you with the exact details.",
    hi: "मेरे पास अभी इस JustTap विषय की सटीक जानकारी नहीं है। JustTap की सहायता टीम आपको सही जानकारी देने में मदद कर सकती है।",
    mr: "माझ्याकडे सध्या या JustTap विषयाची अचूक माहिती नाही. JustTap ची सहाय्य टीम तुम्हाला योग्य माहिती देण्यात मदत करू शकते."
  };

  // These are the only generic instructions we can safely provide without
  // a matching KB record. They contain no invented product details.
  if (input.intent === 'knowledge' && /login|account|password|credential/i.test(input.normalizedMessage)) {
    return safeFallbacks[input.language] ?? safeFallbacks.en;
  }

  if (input.intent === 'unknown_query') {
    return safeFallbacks[input.language] ?? safeFallbacks.en;
  }

  return safeFallbacks[input.language] ?? safeFallbacks.en;
}
