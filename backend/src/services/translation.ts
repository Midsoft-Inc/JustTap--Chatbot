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
 * Deterministic multilingual normalization for common JustTap intents.
 *
 * This layer is intentionally small and business-focused. It converts
 * common Hindi/Marathi native-script and Roman-script requests into the
 * canonical English form used by the existing intent/RAG pipeline.
 *
 * The detected language is NOT changed here. Only the query representation
 * is normalized, so the existing answer layer can still respond in Hindi
 * or Marathi.
 */
function deterministicNormalize(text: string): string | null {
  const value = text
    .trim()
    .toLowerCase()
    .replace(/[।!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return null;

  // ---------------------------------------------------------
  // Service detection
  // ---------------------------------------------------------
  const plumber =
    /\bplumber\b|\bplumbing\b|\bpipe\b|\btap\b|\bfaucet\b|\bsink\b|\btoilet\b|\bdrain\b|water\s*leak|\bनल\b|\bनळ\b|\bपाइप\b|\bप्लंबर\b|\bप्लम्बिंग\b|\bनलसाजी\b|\bटॅप\b|\bपाणी\s*गळती\b|\bनळाची\b/iu.test(value);

  const electrician =
    /\belectrician\b|\belectrical\b|\bwiring\b|\bswitch\b|\bsocket\b|\blight\b|\bfan\b|\bइलेक्ट्रीशियन\b|\bइलेक्ट्रिशियन\b|\bइलेक्ट्रिकल\b|\bवायरिंग\b|\bवीज\b|\bइलेक्ट्रिशियन\b/iu.test(value);

  const carpenter =
    /\bcarpenter\b|\bcarpentry\b|\bwood\b|\bfurniture\b|\bdoor\b|\bwardrobe\b|\bकारपेंटर\b|\bसुतार\b|\bलाकूड\b|\bफर्निचर\b|\bदरवाजा\b|\bदरवाजे\b/iu.test(value);

  const service =
    /\bservice\b|\bseva\b|\bservices\b|\bसेवा\b|\bसेवाएं\b|\bसेवाएँ\b|\bसेवा\b/iu.test(value);

  const serviceName = plumber
    ? 'plumber'
    : electrician
      ? 'electrician'
      : carpenter
        ? 'carpenter'
        : null;

  // ---------------------------------------------------------
  // Booking
  // ---------------------------------------------------------
  const bookingRequested =
    /\bbook\b|\bbooking\b|\bbuk\b|\bschedule\b|\bबुक\b|\bबुकिंग\b|\bबुक\s*कर\b|\bबुक\s*करना\b|\bबुक\s*करनी\b|\bबुक\s*कराय\b|\bबुक\s*करायची\b|\bबुकिंग\s*करायची\b|\bसेवा\s*बुक\b|\bसेवा\s*बुकिंग\b/iu.test(value);

  if (bookingRequested && serviceName) {
    return `I want to book ${serviceName}`;
  }

  if (bookingRequested && service) {
    return 'I want to book a service';
  }

  // ---------------------------------------------------------
  // Price
  // ---------------------------------------------------------
  const priceRequested =
    /\bprice\b|\bcost\b|\bcharge\b|\brate\b|\bkimat\b|\bkimmat\b|\bkitna\b|\bkitni\b|\bpaisa\b|\bpaise\b|\bकिंमत\b|\bकिती\b|\bकितना\b|\bकितनी\b|\bकिंमत\b|\bदर\b|\bपैसे\b|\bकीमत\b/iu.test(value);

  if (priceRequested && serviceName) {
    return `What is the price for ${serviceName}?`;
  }

  if (priceRequested && service) {
    return 'What is the price for the service?';
  }

  // ---------------------------------------------------------
  // Payment problems
  // ---------------------------------------------------------
  if (
    /(?:mera|meri|mere)\s+(?:payment|पेमेंट|bhugtan).*(?:ruk|rukh|atak|atka|atki|pending|stuck|fail|failed|nahi hua|nahi hui)/iu.test(value) ||
    /(?:payment|पेमेंट|भुगतान).*(?:ruk|atak|pending|stuck|fail|failed|नहीं हुआ|नहीं हुई|अटक)/iu.test(value)
  ) {
    if (/(?:fail|failed|failure|nahi hua|nahi hui|नहीं हुआ|नहीं हुई|फेल)/iu.test(value)) {
      return 'My payment failed';
    }
    return 'My payment is stuck';
  }

  if (
    /(?:mere|meri|mera)\s+(?:paise|paisa|amount|rakam).*(?:kat|kate|cut|deduct)/iu.test(value) ||
    /(?:पैसे|रक्कम|रकम|amount).*(?:कट|काट|deduct|कटले|कापले)/iu.test(value)
  ) {
    return 'Money was deducted from my account';
  }

  if (
    /(?:payment|पेमेंट|भुगतान).*(?:problem|issue|error|dikkat|pareshani|samasy|समस्या|अडचण|त्रुटी)/iu.test(value)
  ) {
    return 'I have a payment problem';
  }

  // ---------------------------------------------------------
  // Provider
  // ---------------------------------------------------------
  if (
    /(?:provider|service provider).*(?:near|nearby|mere paas|aas paas)/iu.test(value) ||
    /(?:प्रोवाइडर|सेवा प्रदाता).*(?:पास|जवळ|जवळपास)/iu.test(value)
  ) {
    return 'How can I find a service provider near me?';
  }

  // ---------------------------------------------------------
  // JustTap overview / identity
  // ---------------------------------------------------------
  if (
    /(?:what|kya).*(?:justtap).*(?:do|hai|he|works|kaam)/iu.test(value) ||
    /justtap.*(?:kya hai|kya karta|kaise kaam)/iu.test(value) ||
    /justtap.*(?:क्या है|क्या करता|कैसे काम)/iu.test(value) ||
    /justtap.*(?:काय आहे|काय करते|कसे काम करते)/iu.test(value)
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

  // Always try deterministic normalization first. This works even when
  // Hugging Face inference is unavailable or credits are exhausted.
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
  rescheduling, and support meaning.
- Understand Indian languages written in native scripts.
- Understand Indian languages written using English/Roman letters.
- If the user asks to book a named service, keep the exact service name
  in English (for example: plumber, electrician, carpenter).
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

    const content = response.choices?.[0]?.message?.content;

    if (content && typeof content === 'string' && content.trim()) {
      const result = content
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .replace(/\s+/g, ' ');

      // Do not pass an untranslated native-script response into the English
      // intent/RAG pipeline. If the model returned native script, fall back
      // instead of silently poisoning downstream retrieval.
      const containsNativeIndianScript =
        /[\u0900-\u097F\u0980-\u09FF\u0A80-\u0AFF\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]/u.test(result);

      if (!containsNativeIndianScript) {
        console.log(
          `[TRANSLATION] llm: "${input}" -> "${result}"`
        );
        return result;
      }

      console.warn(
        '[TRANSLATION] LLM returned non-English/native-script output; using deterministic fallback.'
      );
    }
  } catch (error) {
    console.error(
      '[TRANSLATION] Hugging Face normalization failed:',
      error
    );
  }

  // Never crash the request. For unsupported phrases, preserving the input
  // is safer than inventing meaning. Known Hindi/Marathi critical phrases
  // have already been handled deterministically above.
  return input;
}
