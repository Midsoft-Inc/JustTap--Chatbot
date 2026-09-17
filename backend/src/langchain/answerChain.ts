
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
  const strongMatch = input.hits.length > 0 && input.topScore >= input.minRelevanceScore;

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
- For Hindi responses, write explanatory sentences in Hindi script.
- For Marathi responses, write explanatory sentences in Marathi script.
- For English responses, write explanatory sentences in English.
- Keep "JustTap" unchanged.
- Keep every service name and category name exactly as provided in the knowledge context.
- Do not translate, transliterate, rename, shorten, merge, or otherwise modify service names or category names.

- Use the same structured response format for every answer.


- Do not use #, ##, ###, or other Markdown heading syntax.
- After the heading, present the information point-by-point.
- Use "-" for explanatory points or lists.
- Use numbered lists when explaining ordered steps or procedures.
- Keep paragraphs short.
- Do not write long blocks of text when the information can be presented as points.

- For a specific service:

  - Answer only the user's current request about that service.
  - Provide only information relevant to that service.
  - Present the information point-by-point.
  - Do not mention, list, recommend, or append any other service or category unless the user explicitly asks for them.
  - Do not append the complete services overview.

- For a specific category:
  - Create a heading using the category name.
  - Provide only that category's supported services.
  - Present services point-by-point or as a numbered list when appropriate.

- For a booking request:
  - Create a short booking-related heading using the exact requested service name.
  - Answer only the user's booking request for that service.
  - Provide only the booking information supported by the knowledge context.
  - If the knowledge context provides ordered booking steps, use a numbered list.
  - If the user asks about a service, booking, cancellation, or price, print "Learn More" at the end of the response.
  - Do not add unsupported booking steps.
  - Do not mention, list, recommend, or append any other service or category unless the user explicitly asks for them.
  - Use numbered lists for services under each category.
  - Include the complete relevant list from the knowledge context.
  - Do not add booking, pricing, cancellation, or unrelated information unless explicitly requested.

- Preserve the exact service names and category names from the knowledge context.
- Do not invent, rename, merge, reorder, or remove services.
- Do not use "..." when the knowledge context contains the complete list.
- Use "-" for categories.
- Use numbered lists for services under each category.
- Include the complete relevant list from the knowledge context.
- Do not add booking, pricing, cancellation, or unrelated information unless explicitly requested.
- Analyze ONLY the customer's CURRENT question.
- Do not inherit language, intent, category, or service from previous conversation messages unless the current question explicitly refers to them.
- Determine the language from the current question itself.
- A Hindi conversation does not mean the current question is Hindi.
- If the current question is English, detected language must be English.
- If the current question is Hindi, detected language must be Hindi.
- If the current question is Marathi, detected language must be Marathi.
- Determine intent from what the customer is asking in the CURRENT question.
- For Hindi:
  - Write the explanatory content in Hindi.
  - Keep service names and category names exactly as provided in the knowledge context.

- For Marathi:
  - Write the explanatory content in Marathi.
  - Keep service names and category names exactly as provided in the knowledge context.

- For English:
  - Write the complete response in English.

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
