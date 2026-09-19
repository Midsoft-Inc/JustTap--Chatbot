import { generate } from '../services/huggingface.js';

import { SearchHit } from '../models/types.js';

export type GroundedAnswerInput = {
  message: string;
  normalizedMessage: string;
  language: string;
  intent: string;
  category: string;
  service?: string | null;
  hits: SearchHit[];
  topScore: number;
  minRelevanceScore: number;
};

export async function runAnswerChain(
  input: GroundedAnswerInput
): Promise<string> {
  const responseLanguage =
    input.language.toLowerCase().split(/[-_]/)[0];

  const safeFallbacks: Record<string, string> = {
    en: "I don't have exact information about that JustTap topic yet. The JustTap support team can help you with the exact details.",
    hi: "मेरे पास अभी इस JustTap विषय की सटीक जानकारी नहीं है। JustTap की सहायता टीम आपको सही जानकारी देने में मदद कर सकती है।",
    mr: "माझ्याकडे सध्या या JustTap विषयाची अचूक माहिती नाही. JustTap ची सहाय्य टीम तुम्हाला योग्य माहिती देण्यात मदत करू शकते."
  };

  // Login/account access has no grounded KB record in the current dataset.
  // Never let an unrelated high-scoring hit reach the LLM for this intent.
  if (input.intent === 'login') {
    return safeFallbacks[responseLanguage] ?? safeFallbacks.en;
  }

  const strongMatch =
    input.hits.length > 0 &&
    input.topScore >= input.minRelevanceScore;

  if (strongMatch) {
    const normalizedService = input.service?.trim().toLowerCase() || null;

    // For a resolved service request, give the model only KB records for that
    // exact service. The KB uses its own intent names (for example
    // service_booking), so filtering by semantic intent here would incorrectly
    // remove valid records. Retrieval/reranking already orders the matching
    // records; this step only removes unrelated services that can cause the
    // LLM to merge or repeat information.
    const relevantHits = normalizedService
      ? input.hits.filter(
          (hit) =>
            hit.sub_service?.trim().toLowerCase() === normalizedService
        )
      : input.hits;

    const contextHits =
      relevantHits.length > 0 ? relevantHits : input.hits.slice(0, 1);

    const context = contextHits
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
- Do not omit information that is relevant to the CURRENT question, but do not repeat the same fact when multiple KB records contain overlapping wording.
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
  - Do not generate the Learn More link yourself; the application adds the localized link after generation.
  - For English, the link text must be exactly "Learn More".
  - For Hindi, the link text must be exactly "लर्न मोर".
  - Do not use "Learn More" in a Hindi response.
  - Do not use "लर्न मोर" in an English response.
  - The Learn More text must not be translated into any other wording.
  - Do not add unsupported booking steps.
  - Do not mention, list, recommend, or append any other service or category unless the user explicitly asks for them.
  - Use numbered lists for services under each category when a category list is requested.
  - Do not include unrelated category/service records for a specific booking request.
  - Do not add booking, pricing, cancellation, or unrelated information unless explicitly requested.

- Preserve the exact service names and category names from the knowledge context.
- Do not invent, rename, merge, reorder, or remove services.
- Do not use "..." when the knowledge context contains the complete list.
- Use "-" for categories.
- Use numbered lists for services under each category.
- Include the complete relevant list from the knowledge context.
- Do not add booking, pricing, cancellation, or unrelated information unless explicitly requested.

- Analyze ONLY the customer's CURRENT question for what they are asking.
- Do not inherit intent, category, or service from previous conversation messages unless the current question explicitly refers to them.
- The application's requested response language is authoritative.
- Do not infer a different response language from the current question.
- If the requested response language is Hindi, write all explanatory content in Hindi script.
- If the requested response language is Marathi, write all explanatory content in Marathi script.
- If the requested response language is English, write all explanatory content in English.
- Keep service names and category names exactly as provided in the knowledge context.
- Do not copy English explanatory sentences from an English KB answer when the requested response language is Hindi or Marathi.
`.trim();

    const answer = await generate(prompt, input.language, 320);

    // Force the correct localized Learn More link.
// Force the Learn More text and link according to the response language.
  // Force the correct localized Learn More link.
  const learnMoreText =
    responseLanguage === 'hi'
      ? 'लर्न मोर'
      : responseLanguage === 'mr'
        ? 'अधिक जाणून घ्या'
        : 'Learn More';

  const learnMoreLink =
    `[${learnMoreText}](https://www.justtapnow.com/about)`;

  // Add a separate Safety & Guidelines link only for safety-related questions.
  const safetyText =
    responseLanguage === 'hi'
      ? 'JustTap सुरक्षा और दिशानिर्देश'
      : responseLanguage === 'mr'
        ? 'JustTap सुरक्षा आणि मार्गदर्शक तत्त्वे'
        : 'JustTap Safety & Guidelines';

  const safetyLink =
    `[${safetyText}](https://www.justtapnow.com/safety)`;

  const safetyPattern =
    /safety|safe|security|guideline|guidelines|unsafe|otp|pin|cvv|password|scam|fraud|सुरक्षा|सुरक्षित|धोखाधड़ी|धोका|मार्गदर्शक/i;

  const isSafetyRequest =
    safetyPattern.test(
      `${input.message} ${input.normalizedMessage} ${input.intent} ${input.category}`
    ) ||
    input.hits.some((hit) =>
      safetyPattern.test(
        `${hit.intent} ${hit.question} ${hit.answer} ${hit.category} ${hit.sub_service ?? ''}`
      )
    );

  if (isSafetyRequest) {
    const cleanedAnswer = answer
      .replace(
        /\[\s*\*{0,2}(?:Learn\s+More|लर्न\s+मोर|अधिक\s+जाणून\s+घ्या|JustTap Safety & Guidelines|JustTap सुरक्षा और दिशानिर्देश|JustTap सुरक्षा आणि मार्गदर्शक तत्त्वे)\s*\*{0,2}\s*\]\([^)]*\)/gi,
        ''
      )
      .replace(
        /\*{0,2}(?:Learn\s+More|लर्न\s+मोर|अधिक\s+जाणून\s+घ्या|JustTap Safety & Guidelines|JustTap सुरक्षा और दिशानिर्देश|JustTap सुरक्षा आणि मार्गदर्शक तत्त्वे)\*{0,2}/gi,
        ''
      )
      .trim();

    return `${cleanedAnswer}\n\n${safetyLink}`;
  }

  const needsLearnMore =
    /service|book|booking|cancel|cancellation|price|pricing/i.test(
      `${input.intent} ${input.normalizedMessage}`
    ) ||
    input.hits.some((hit) =>
      /service|book|booking|cancel|cancellation|price|pricing/i.test(
        `${hit.intent} ${hit.question} ${hit.sub_service ?? ''}`
      )
    );

  if (needsLearnMore) {
    // Remove any existing Learn More link/text generated by the model.
    const cleanedAnswer = answer
      .replace(
        /\[\s*\*{0,2}(?:Learn\s+More|लर्न\s+मोर|अधिक\s+जाणून\s+घ्या)\s*\*{0,2}\s*\]\([^)]*\)/gi,
        ''
      )
      .replace(
        /\*{0,2}(?:Learn\s+More|लर्न\s+मोर|अधिक\s+जाणून\s+घ्या)\*{0,2}/gi,
        ''
      )
      .trim();

    return `${cleanedAnswer}\n\n${learnMoreLink}`;
  }

  return answer;
  }

  if (
    input.intent === 'knowledge' &&
    /login|account|password|credential/i.test(
      input.normalizedMessage
    )
  ) {
    return safeFallbacks[responseLanguage] ?? safeFallbacks.en;
  }

  if (input.intent === 'unknown_query') {
    return safeFallbacks[responseLanguage] ?? safeFallbacks.en;
  }

  return safeFallbacks[responseLanguage] ?? safeFallbacks.en;
}