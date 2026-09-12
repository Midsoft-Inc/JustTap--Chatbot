
import { RunnableLambda } from '@langchain/core/runnables';

import { detectLanguage } from '../services/language.js';
import { normalizeQuery } from '../services/translation.js';
import { runSemanticChain, SemanticResult } from './semanticChain.js';
import { runRagChain } from './retrieval.js';
import { getRecentTurns, getConversationLanguage, MemoryTurn } from './memory.js';
import { getCachedAnswer } from './cache.js';
import { isContentless, stripEmoji, normalizeDomainQuery } from './textSignal.js';
import { SearchHit } from '../models/types.js';

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
    const loginPattern =
      /\b(login|log[ -]?in|sign[ -]?in|signin)\b/i.test(state.normalizedMessage) &&
      /\b(how|can|do|to|help|access|account|kaise|kese|kare|karo|karu|karna|karne)\b/i.test(state.normalizedMessage);

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
      return {
        language: responseLanguage,
        normalizedMessage,
        semantic,
        stage: 'clarification',
        answer: CLARIFICATION_REPLIES[responseLanguage] ?? CLARIFICATION_REPLIES.en
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
  const tCache = Date.now();
  const cached = await getCachedAnswer(afterLanguage.normalizedMessage, afterLanguage.responseLanguage);
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
