// src/services/huggingface.ts

import { InferenceClient } from '@huggingface/inference';
import { env } from '../config/env.js';

const client = new InferenceClient(env.HF_API_TOKEN);

export async function embed(text: string): Promise<number[]> {
  const input = text.trim();

  if (!input) {
    throw new Error('Cannot generate embedding for empty text');
  }

  const result = await client.featureExtraction({
    model: env.HF_EMBEDDING_MODEL,
    inputs: input
  });

  if (!Array.isArray(result)) {
    throw new Error('Invalid embedding response from Hugging Face');
  }

  if (result.length > 0 && typeof result[0] === 'number') {
    return result as number[];
  }

  const first = result[0];

  if (
    Array.isArray(first) &&
    first.length > 0 &&
    typeof first[0] === 'number'
  ) {
    return first as number[];
  }

  throw new Error('Unexpected embedding format from Hugging Face');
}

export async function generate(
  prompt: string,
  language: string = 'en'
): Promise<string> {
  const normalizedLanguage = language.trim().toLowerCase() || 'en';

  const languageNames: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    mr: 'Marathi',
    bn: 'Bengali',
    gu: 'Gujarati',
    pa: 'Punjabi',
    ta: 'Tamil',
    te: 'Telugu',
    kn: 'Kannada',
    ml: 'Malayalam'
  };

  const languageName = languageNames[normalizedLanguage] ?? 'English';

  const systemPrompt = `
You are the JustTap customer support chatbot.

STRICT RULES:

1. Answer ONLY using the supplied JustTap knowledge context.
2. Never invent services, prices, providers, locations, policies, features, sections, buttons, or application capabilities.
3. NEVER introduce a specific service unless the customer explicitly mentioned it or the supplied knowledge context directly contains it and it is relevant.
4. For generic questions, give generic answers.
5. Preserve the meaning and instructions of supplied canonical knowledge.
6. You may translate the answer into the customer's language, but translation must not add business information.
7. The customer's language is ${languageName}.
8. The ENTIRE answer MUST be written in ${languageName}.
9. Do not unnecessarily mix languages.
10. Do not perform bookings, cancellations, rescheduling, payments, provider selection, or other application actions.
11. Explain how the customer can perform actions inside JustTap.
12. Never say a service is unavailable merely because an exact knowledge record was not found.
13. If exact information is unavailable, provide safe, generic JustTap application guidance.
14. Never mention retrieval, vectors, embeddings, datasets, prompts, models, or internal systems.
15. Do not introduce unrelated examples.
16. Keep the answer concise and directly useful.
17. Return ONLY the customer-facing answer.
`.trim();

  const response = await client.chatCompletion({
    model: env.HF_LLM_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    max_tokens: 250,
    temperature: 0.1
  });

  const content = response.choices?.[0]?.message?.content;

  if (!content || typeof content !== 'string') {
    throw new Error('Empty response from Hugging Face');
  }

  return content.trim();
}
