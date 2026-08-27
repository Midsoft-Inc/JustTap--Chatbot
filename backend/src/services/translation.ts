// src/services/translation.ts

import { InferenceClient } from '@huggingface/inference';
import { env } from '../config/env.js';

const client = new InferenceClient(env.HF_API_TOKEN);

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

/**
 * Small deterministic normalization layer for common Roman Hindi/Marathi
 * customer-support phrases. The LLM remains the general multilingual
 * translation layer.
 */
function deterministicNormalize(text: string): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  // Payment problems
  if (
    /(?:mera|meri|mere)\s+(?:payment|पेमेंट|bhugtan)\s+(?:ruk|rukh|atak|atka|atki|pending|stuck)\s+(?:gaya|gayi|hai|hain)?/i.test(value) ||
    /(?:payment|पेमेंट)\s+(?:ruk|rukh|atak|atka|atki|pending|stuck)\s+(?:gaya|gayi|hai|hain)?/i.test(value)
  ) {
    return 'My payment is stuck';
  }

  if (
    /(?:mera|meri|mere)\s+(?:payment|पेमेंट).*(?:fail|failed|failure|nahi hua|nahi hui)/i.test(value)
  ) {
    return 'My payment failed';
  }

  if (
    /(?:mere|meri|mera)\s+(?:paise|paisa|amount|rakam).*(?:kat|kate|cut|deduct)/i.test(value)
  ) {
    return 'Money was deducted from my account';
  }

  if (
    /(?:payment|पेमेंट).*(?:problem|issue|error|dikkat|pareshani|samasy)/i.test(value)
  ) {
    return 'I have a payment problem';
  }

  // Booking
  if (
    /(?:mujhe|main|mai|me)\s+(?:ek\s+)?(?:service|seva).*(?:book|booking|buk)/i.test(value) ||
    /(?:mujhe|main|mai|me).*?(?:book|booking|buk).*?(?:service|seva)/i.test(value)
  ) {
    return 'I want to book a service';
  }

  if (/(?:service|seva).*(?:book|booking|buk)/i.test(value)) {
    return 'I want to book a service';
  }

  // Price
  if (
    /(?:kitna|kitni|kya).*(?:price|cost|charge|rate|paisa|paise|kimat|kimmat)/i.test(value) ||
    /(?:price|cost|charge|rate|kimat|kimmat).*(?:service|seva)/i.test(value)
  ) {
    return 'What is the price of the service?';
  }

  // Provider
  if (
    /(?:provider|service provider).*(?:near|nearby|mere paas|aas paas)/i.test(value)
  ) {
    return 'How can I find a service provider near me?';
  }

  // JustTap
  if (
    /(?:what|kya).*(?:justtap).*(?:do|hai|he|works|kaam)/i.test(value) ||
    /justtap.*(?:kya hai|kya karta|kaise kaam)/i.test(value)
  ) {
    return 'What is JustTap?';
  }

  return null;
}

/**
 * Normalize a customer query into English for deterministic intent
 * classification and retrieval.
 */
export async function normalizeQuery(
  text: string,
  language: string
): Promise<string> {
  const input = text.trim();

  if (!input) return '';

  const normalizedLanguage = (language || 'en')
    .trim()
    .toLowerCase();

  // English does not need translation.
  if (normalizedLanguage === 'en') {
    return input;
  }

  // Fast deterministic handling for common Roman Hindi/Marathi support
  // phrases. This prevents critical intents from depending on an LLM
  // interpreting a short Roman-script message correctly.
  const deterministic = deterministicNormalize(input);

  if (deterministic) {
    console.log(
      `[TRANSLATION] deterministic: "${input}" -> "${deterministic}"`
    );
    return deterministic;
  }

  const languageName =
    languageNames[normalizedLanguage] ?? normalizedLanguage;

  const prompt = `
You are the multilingual query-normalization layer for the
JustTap customer-support chatbot.

Translate the user's message into concise natural English.

Rules:
- Translate only. Do NOT answer the user.
- Preserve the exact meaning.
- Do not add or remove information.
- Preserve service names and important entities.
- Preserve booking, payment, provider, pricing, cancellation,
  and support meaning.
- Understand Indian languages written in native scripts.
- Understand Indian languages written using English/Roman letters.
- Return ONLY the normalized English query.
- Do not explain the translation.
- Do not return JSON.
- Do not use quotation marks.

Detected language: ${languageName}

User message:
${input}
`.trim();

  try {
    const response = await client.chatCompletion({
      model: env.HF_LLM_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Translate and normalize the customer query into English. Return only the normalized English query.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 120,
      temperature: 0
    });

    const content =
      response.choices?.[0]?.message?.content;

    if (content && typeof content === 'string' && content.trim()) {
      const result = content
        .trim()
        .replace(/^["']|["']$/g, '')
        .replace(/\s+/g, ' ');

      console.log(
        `[TRANSLATION] llm: "${input}" -> "${result}"`
      );

      return result;
    }
  } catch (error) {
    console.error(
      '[TRANSLATION] Hugging Face normalization failed:',
      error
    );
  }

  // Safe fallback: preserve the original query instead of crashing.
  return input;
}
