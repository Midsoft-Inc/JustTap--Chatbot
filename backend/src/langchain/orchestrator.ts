
import { RunnableLambda } from '@langchain/core/runnables';

import { detectLanguage } from '../services/language.js';
import { normalizeQuery } from '../services/translation.js';
import { runSemanticChain, SemanticResult } from './semanticChain.js';
import { runRagChain } from './retrieval.js';
import { getRecentTurns, getConversationLanguage, MemoryTurn } from './memory.js';
import { getCachedAnswer } from './cache.js';
import { isContentless, stripEmoji, normalizeDomainQuery } from './textSignal.js';
import { SearchHit } from '../models/types.js';
import { classifyIntent } from '../services/intent.js';
import { env } from '../config/env.js';

export type OrchestratorInput = {
  sessionId: string;
  message: string;
  responseLanguage?: string;
};

export type OrchestratorStage = 'small_talk' | 'clarification' | 'support_issue' | 'grounded';

export type OrchestratorResult = {
  language: string;
  normalizedMessage: string;
  semantic: SemanticResult;
  stage: OrchestratorStage;
  answer?: string; // pre-built reply for small_talk / clarification stages,
                    // and for a cache-hit grounded answer (see cache.ts)
  hits?: SearchHit[]; // populated for the grounded stage
  topScore?: number; // populated for the grounded stage
  timings?: Record<string, number>; // per-stage ms, for latency observability
};

const SMALL_TALK_INTENTS = new Set(['greeting', 'thanks', 'goodbye', 'acknowledgement']);

const SMALL_TALK_REPLIES: Record<string, Record<string, string>> = {
  greeting: {
    hi: 'नमस्ते! मैं JustTap के बारे में जानकारी और सहायता देने के लिए यहाँ हूँ।',
    mr: 'नमस्कार! मी JustTap बद्दल माहिती आणि सहाय्य देण्यासाठी येथे आहे.',
    en: 'Hello! I can help with information and support related to JustTap.'
  },
  thanks: {
    hi: 'आपका स्वागत है!',
    mr: 'आपले स्वागत आहे!',
    en: "You're welcome!"
  },
  goodbye: {
    hi: 'धन्यवाद! आपका दिन शुभ हो।',
    mr: 'धन्यवाद! तुमचा दिवस शुभ जावो.',
    en: 'Thank you! Have a great day.'
  },
  acknowledgement: {
    hi: 'ठीक है। यदि आपको JustTap से संबंधित किसी और सहायता की आवश्यकता हो, तो पूछ सकते हैं।',
    mr: 'ठीक आहे. JustTap संबंधित आणखी मदत हवी असल्यास विचारू शकता.',
    bn: 'ঠিক আছে। JustTap সম্পর্কে আরও সাহায্যের প্রয়োজন হলে জিজ্ঞাসা করতে পারেন।',
    gu: 'બરાબર. JustTap સંબંધિત વધુ મદદની જરૂર હોય તો પૂછો.',
    en: 'Okay. If you need any further help with JustTap, feel free to ask.'
  }
};

const CLARIFICATION_REPLIES: Record<string, string> = {
  hi: 'ठीक है, मैं आपकी मदद कर सकता हूँ। आप कौन-सी सेवा चाहते हैं?',
  mr: 'ठीक आहे, मी तुमची मदत करू शकतो. तुम्हाला कोणती सेवा हवी आहे?',
  en: 'Okay, I can help. What service do you need?'
};

function smallTalkReply(intent: string, language: string): string {
  const set = SMALL_TALK_REPLIES[intent] ?? SMALL_TALK_REPLIES.acknowledgement;
  return set[language] ?? set.en;
}

// Step 1 + 2: Language Detection -> Normalization (+ pull conversation memory)
//
// Emoji are stripped before language detection/translation so stray
// characters can't interfere with the regex/script-based detector or
// sit unexplained inside the translation prompt. normalizeQuery() (a
// translation LLM call, when the input isn't already English) and the
// conversation-memory fetch are independent of each other, so they run
// concurrently instead of one after another -- a real latency win, not
// just a cosmetic one.
const languageStep = RunnableLambda.from(async (input: OrchestratorInput) => {
  const cleanedMessage = stripEmoji(input.message) || input.message;
  const inputLanguage = detectLanguage(cleanedMessage);
  const [normalizedMessage, history, storedConversationLanguage] = await Promise.all([
    normalizeQuery(cleanedMessage, inputLanguage).then(normalizeDomainQuery),
    getRecentTurns(input.sessionId),
    getConversationLanguage(input.sessionId)
  ]);

  // The selected chat language (the toggle sent as responseLanguage) is
  // the customer's explicit choice for what language they want to be
  // answered in, and it must win regardless of what script they happen to
  // type the message in -- an English-chat customer typing a Hindi word
  // still gets an English answer, and a Hindi-chat customer typing in
  // English still gets a Hindi answer. inputLanguage/storedConversationLanguage
  // are only fallbacks for the (currently rare, since the frontend always
  // sends a toggle value) case where no explicit responseLanguage arrives.
  const responseLanguage =
    input.responseLanguage?.trim().toLowerCase() ||
    inputLanguage ||
    storedConversationLanguage ||
    'en';

  return { ...input, language: inputLanguage, responseLanguage, normalizedMessage, history };
});

// Step 3: Semantic LLM Chain -> Intent / Service / Entities -> Conversation State
const semanticStep = RunnableLambda.from(
  async (state: OrchestratorInput & { language: string; responseLanguage: string; normalizedMessage: string; history: MemoryTurn[] }) => {
    // Deterministic login guard: inspect BOTH the original current message and
    // the normalized message. Do not depend on the semantic LLM to recognize
    // login questions, because an unrecognized login query could otherwise
    // continue into RAG and receive invented generic login instructions.
    const loginText = `${state.message} ${state.normalizedMessage}`;
    const loginPattern =
      /\b(login|log[ -]?in|sign[ -]?in|signin)\b/i.test(loginText) &&
      /\b(how|can|do|to|help|access|account|password|credential|kaise|kese|kaise|kare|karo|karu|karna|karne)\b/i.test(loginText)
      || /\b(login|log[ -]?in|sign[ -]?in|signin)\b/i.test(loginText) &&
         /(कैसे|कैसे करें|लॉगिन|लॉग इन|पासवर्ड|अकाउंट|खाता|करूं|करना|करने|करें)/i.test(loginText);

    if (loginPattern) {
      const semantic: SemanticResult = {
        intent: 'login',
        category: 'account',
        service: null,
        entities: {},
        confidence: 1,
        conversationState: 'complete',
        supportIssue: false
      };
      return { ...state, semantic };
    }

    const semanticRaw = await runSemanticChain({
      message: state.message,
      normalizedMessage: state.normalizedMessage,
      language: state.language,
      history: state.history
    });

    return { ...state, semantic: semanticRaw };
  }
);

// Step 4: route on conversation state -- clarification vs. complete -> RAG chain
const routeStep = RunnableLambda.from(
  async (
    state: OrchestratorInput & {
      language: string;
      responseLanguage: string;
      normalizedMessage: string;
      history: MemoryTurn[];
      semantic: SemanticResult;
    }
  ): Promise<OrchestratorResult> => {
    const { semantic, language, responseLanguage, normalizedMessage } = state;

    // Hard safety guard: if the CURRENT user message is a login question,
    // never allow it to proceed to service RAG/LLM generation unless there is
    // an explicitly grounded login record. The current KB does not provide
    // such instructions, so return the deterministic safe response.
    const currentText = `${state.message} ${normalizedMessage}`;
    const isLoginRequest =
      /\b(login|log[ -]?in|sign[ -]?in|signin)\b/i.test(currentText) ||
      /(लॉगिन|लॉग इन|पासवर्ड|अकाउंट|खाता)/i.test(currentText);

    if (isLoginRequest) {
      const loginFallbacks: Record<string, string> = {
        en: "I don't have exact information about JustTap login yet. The JustTap support team can help you with the exact details.",
        hi: 'मेरे पास अभी JustTap लॉगिन की सटीक जानकारी नहीं है। JustTap की सहायता टीम आपको सही जानकारी देने में मदद कर सकती है।',
        mr: 'माझ्याकडे सध्या JustTap लॉगिनची अचूक माहिती नाही. JustTap ची सहाय्य टीम तुम्हाला योग्य माहिती देण्यात मदत करू शकते.'
      };

      return {
        language: responseLanguage,
        normalizedMessage,
        semantic: { ...semantic, intent: 'login', category: 'account', service: null, supportIssue: false },
        stage: 'grounded',
        answer: loginFallbacks[responseLanguage] ?? loginFallbacks.en
      };
    }

    if (SMALL_TALK_INTENTS.has(semantic.intent)) {
      return {
        language: responseLanguage,
        normalizedMessage,
        semantic,
        stage: 'small_talk',
        answer: smallTalkReply(semantic.intent, responseLanguage)
      };
    }

    if (semantic.supportIssue) {
      return { language: responseLanguage, normalizedMessage, semantic, stage: 'support_issue' };
    }

    if (semantic.conversationState === 'needs_clarification') {
      const serviceOptions = semantic.entities?.service_options;
      const unknownService = semantic.entities?.unknown_service;

      if (serviceOptions) {
        const clarificationReplies: Record<string, string> = {
          en: `Which mechanic service would you like to book: ${serviceOptions.replaceAll(' | ', ' or ')}?`,
          hi: `आप कौन-सी mechanic service बुक करना चाहते हैं: ${serviceOptions.replaceAll(' | ', ' या ')}?`,
          mr: `तुम्हाला कोणती mechanic service बुक करायची आहे: ${serviceOptions.replaceAll(' | ', ' किंवा ')}?`
        };

        return {
          language: responseLanguage,
          normalizedMessage,
          semantic,
          stage: 'clarification',
          answer: clarificationReplies[responseLanguage] ?? clarificationReplies.en
        };
      }

      if (unknownService) {
        const unknownServiceReplies: Record<string, string> = {
          en: `I couldn't find "${unknownService}" as a JustTap service. Please choose a service from the available JustTap services.`,
          hi: `मुझे JustTap में "${unknownService}" नाम की कोई सेवा नहीं मिली। कृपया उपलब्ध JustTap सेवाओं में से कोई सेवा चुनें।`,
          mr: `JustTap मध्ये "${unknownService}" नावाची सेवा मला सापडली नाही. कृपया उपलब्ध JustTap सेवांपैकी एखादी सेवा निवडा.`
        };

        return {
          language: responseLanguage,
          normalizedMessage,
          semantic,
          stage: 'clarification',
          answer: unknownServiceReplies[responseLanguage] ?? unknownServiceReplies.en
        };
      }

      return {
        language: responseLanguage,
        normalizedMessage,
        semantic,
        stage: 'clarification',
        answer: CLARIFICATION_REPLIES[responseLanguage] ?? CLARIFICATION_REPLIES.en
      };
    }

    // There is no generic booking KB record. Once semantic analysis confirms
    // that the current question names no service, answer the generic booking
    // question directly instead of allowing RAG to select an arbitrary
    // service-specific record such as CA.
    if (semantic.intent === 'how_to_book' && !semantic.service) {
      const genericBookingReplies: Record<string, string> = {
        en: 'To book a service, open the Services section in the JustTap application, select the service you need, and follow the booking instructions shown there.\n\nLearn More',
        hi: 'सेवा बुक करने के लिए JustTap ऐप में Services सेक्शन खोलें, अपनी आवश्यक सेवा चुनें और वहाँ दिए गए बुकिंग निर्देशों का पालन करें।\n\n[लर्न मोर](https://www.justtapnow.com/about)',
        mr: 'सेवा बुक करण्यासाठी JustTap application मधील Services section उघडा, तुम्हाला आवश्यक असलेली सेवा निवडा आणि तेथे दिलेल्या booking instructions चे पालन करा.\n\n[अधिक जाणून घ्या](https://www.justtapnow.com/about)'
      };

      return {
        language: responseLanguage,
        normalizedMessage,
        semantic,
        stage: 'grounded',
        answer: genericBookingReplies[responseLanguage] ?? genericBookingReplies.en,
        hits: [],
        topScore: 1
      };
    }

    // Complete conversation state -> RAG Chain -> Reranker -> Top KB Context.
    // This now includes unknown_query: instead of an immediate canned
    // reply, it still gets a real retrieval pass, so the fallback stays
    // knowledge-bound rather than generic.
    const loginRetrievalTerms =
      semantic.intent === 'login'
        ? 'login sign in log in account authentication access'
        : '';

    // Keep BOTH the original user-language message and the normalized
    // canonical message in the retrieval query. This prevents RAG from
    // depending entirely on translation/normalization for Hindi, Marathi,
    // and Roman Hindi/Marathi queries.
    //
    // Example:
    //   मैं प्लंबर बुक करना चाहता हूँ।
    //   + I want to book plumber
    //   + how_to_book + service + plumber
    //
    // knowledge.ts can then match either the native-language aliases or
    // the canonical English/service terms.
    const retrievalQuery = [
      state.message,
      normalizedMessage,
      semantic.intent,
      semantic.category,
      semantic.service ?? '',
      ...Object.values(semantic.entities),
      loginRetrievalTerms
    ]
      .filter(Boolean)
      .join(' ');

    const hits = await runRagChain({ query: retrievalQuery, entities: semantic.entities });
    const topScore = hits[0]?.score ?? 0;

    // Hard grounding gate: do not send weak or empty retrieval results to
    // the LLM. A low-confidence retrieval result is not evidence.
    const minRelevanceScore = Number(env.MIN_RELEVANCE_SCORE ?? 0.52);
    if (!hits.length || topScore < minRelevanceScore) {
      const groundedFallbacks: Record<string, string> = {
        hi: 'मुझे इस जानकारी का उत्तर JustTap की उपलब्ध जानकारी में नहीं मिला।\n\n[लर्न मोर](https://www.justtapnow.com/about)',
        mr: 'ही माहिती JustTap च्या उपलब्ध माहितीत सापडली नाही.\n\n[अधिक जाणून घ्या](https://www.justtapnow.com/about)',
        en: 'I could not find this information in the available JustTap information.\n\n[Learn More](https://www.justtapnow.com/about)'
      };

      return {
        language: responseLanguage,
        normalizedMessage,
        semantic,
        stage: 'grounded',
        answer: groundedFallbacks[responseLanguage] ?? groundedFallbacks.en,
        hits,
        topScore
      };
    }

    return { language: responseLanguage, normalizedMessage, semantic, stage: 'grounded', hits, topScore };
  }
);

const EMPTY_SEMANTIC = (intent: string): SemanticResult => ({
  intent,
  category: 'general',
  service: null,
  entities: {},
  confidence: 1,
  conversationState: 'complete',
  supportIssue: false
});

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  // Fast path 1: emoji-only / punctuation-only messages ("🙏", "👍", "!!").
  // There is no question here to ground an answer in, so this never
  // reaches the semantic chain or the LLM at all -- it goes straight to
  // a safe acknowledgement. This is both a latency win (skips language
  // detection's translation call, the semantic chain, retrieval, and
  // generation entirely) and a hallucination fix: an emoji-only message
  // is exactly the kind of "no real content" input a generic-guidance
  // prompt would otherwise improvise an answer for.
  if (isContentless(input.message)) {
    const t0 = Date.now();
    const language = input.responseLanguage || detectLanguage(input.message) || 'en';
    return {
      language,
      normalizedMessage: '',
      semantic: EMPTY_SEMANTIC('acknowledgement'),
      stage: 'small_talk',
      answer: smallTalkReply('acknowledgement', language),
      timings: { contentlessCheck: Date.now() - t0 }
    };
  }

  const tLanguage = Date.now();
  const afterLanguage = await languageStep.invoke(input);
  const languageMs = Date.now() - tLanguage;

  // Fast path 2: an exact repeat of a previously-answered grounded
  // question. Skips the semantic chain, retrieval, reranker, and
  // generation entirely -- the biggest single latency win available for
  // high-traffic repeated questions ("how to login justtap", "how to
  // book a plumber"). Only grounded-stage answers are ever cached (see
  // cache.ts), so this can never return a stale ticket ID or a
  // conversation-state-dependent clarification.
  const deterministicIntent = classifyIntent(afterLanguage.normalizedMessage);
  const isGenericBookingCandidate =
    deterministicIntent.intent === 'how_to_book';
  const isLoginCandidate =
    /\b(login|log[ -]?in|sign[ -]?in|signin)\b/i.test(afterLanguage.normalizedMessage) ||
    /(लॉगिन|लॉग इन|पासवर्ड|अकाउंट|खाता)/i.test(afterLanguage.message);

  const tCache = Date.now();
  const cached = isGenericBookingCandidate || isLoginCandidate
    ? null
    : await getCachedAnswer(afterLanguage.normalizedMessage, afterLanguage.responseLanguage);
  const cacheMs = Date.now() - tCache;

  if (cached) {
    console.log('[CACHE] hit', {
      language: afterLanguage.responseLanguage,
      normalizedMessage: afterLanguage.normalizedMessage
    });
    return {
      language: afterLanguage.responseLanguage,
      normalizedMessage: afterLanguage.normalizedMessage,
      semantic: EMPTY_SEMANTIC(cached.intent),
      stage: 'grounded',
      answer: cached.answer,
      hits: [],
      topScore: 1,
      timings: { language: languageMs, cacheLookup: cacheMs }
    };
  }

  console.log('[CACHE] miss', {
    language: afterLanguage.responseLanguage,
    normalizedMessage: afterLanguage.normalizedMessage
  });

  const tSemantic = Date.now();
  const afterSemantic = await semanticStep.invoke(afterLanguage);
  const semanticMs = Date.now() - tSemantic;

  const tRoute = Date.now();
  const result = await routeStep.invoke(afterSemantic);
  const routeMs = Date.now() - tRoute;

  return {
    ...result,
    timings: { language: languageMs, cacheLookup: cacheMs, semantic: semanticMs, route: routeMs }
  };
}
