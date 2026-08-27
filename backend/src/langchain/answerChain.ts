// src/langchain/answerChain.ts
//
// Diagram stage: Grounded Answer LLM Chain -> User's Language.
//
// This is the single place that turns retrieved KB context into a
// customer-facing answer. It replaces the two near-duplicate prompt
// blocks that used to live inline in chat.ts (5A strong match / 5C low
// score guidance). The strict grounding rules themselves (never invent
// services/prices/providers, answer only from context, respond in the
// user's language, etc.) live in the model's system prompt -- see
// services/huggingface.ts generate() -- so this file only builds the
// task-specific instructions for each call.

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
- Do not introduce unrelated services.
- Do not introduce unrelated examples.
- Do not say a service is unavailable.
- Answer entirely in the detected language.
- Keep the answer concise.
`.trim();

    return generate(prompt, input.language);
  }

  // Knowledge-bound fallback: even when there's no sufficiently specific
  // record (including genuinely unknown_query messages), the answer still
  // comes from this same grounded chain rather than a hardcoded generic
  // sentence -- it just falls back to safe, generic JustTap guidance
  // instead of a specific knowledge record.
  const guidancePrompt = `
Detected language: ${input.language}

User intent: ${input.intent}

User category: ${input.category}

Original user question:
${input.message}

There is no sufficiently specific knowledge record
for this exact question.

Provide only safe, generic guidance for using
the JustTap application.

IMPORTANT:

- Do NOT say that the service is unavailable.
- Do NOT claim that JustTap does not provide the service.
- Do NOT invent a service.
- Do NOT invent a price.
- Do NOT invent a provider.
- Do NOT invent a policy.
- Do NOT invent availability.
- Do NOT select a provider.
- Do NOT perform an application action.
- If the user asks how to find a service, explain that
  they can use the Services section of the JustTap app.
- If the user asks how to book, explain that they can
  use the relevant service/booking section.
- If the user asks about cancellation, explain that they
  can use the relevant booking section and follow the
  available cancellation instructions.
- If the user asks about rescheduling, explain that they
  can use the relevant booking section and follow the
  available rescheduling instructions.
- If the user asks about providers, explain that they can
  search for the required service and area in the app.
- If the message is unrelated to JustTap, politely say you
  can only help with JustTap-related questions.
- Respond entirely in the detected language.
- Keep the answer concise.
`.trim();

  return generate(guidancePrompt, input.language);
}
