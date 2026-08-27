// src/langchain/orchestrator.ts
//
// The LangChain orchestrator from the target diagram:
//
//   Language Detection -> Normalization -> Semantic LLM Chain
//     -> Intent / Service / Entities -> Conversation State
//       -> needs_clarification -> Ask user
//       -> complete             -> RAG Chain -> Reranker -> Grounded
//                                  Answer LLM Chain -> User's Language
//
// This module owns the *routing* decision (small talk / clarification /
// support ticket / grounded RAG answer). It does not itself create
// tickets or write to the database -- those stay in services/chat.ts,
// which still owns the "other connections" (Mongo, ticket creation)
// exactly as before.

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';

import { detectLanguage } from '../services/language.js';
import { normalizeQuery } from '../services/translation.js';
import { runSemanticChain, SemanticResult } from './semanticChain.js';
import { runRagChain } from './retrieval.js';
import { getRecentTurns, MemoryTurn } from './memory.js';
import { SearchHit } from '../models/types.js';

export type OrchestratorInput = {
  sessionId: string;
  message: string;
};

export type OrchestratorStage = 'small_talk' | 'clarification' | 'support_issue' | 'grounded';

export type OrchestratorResult = {
  language: string;
  normalizedMessage: string;
  semantic: SemanticResult;
  stage: OrchestratorStage;
  answer?: string; // pre-built reply for small_talk / clarification stages
  hits?: SearchHit[]; // populated for the grounded stage
  topScore?: number; // populated for the grounded stage
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
const languageStep = RunnableLambda.from(async (input: OrchestratorInput) => {
  const language = detectLanguage(input.message);
  const normalizedMessage = await normalizeQuery(input.message, language);
  const history = await getRecentTurns(input.sessionId);
  return { ...input, language, normalizedMessage, history };
});

// Step 3: Semantic LLM Chain -> Intent / Service / Entities -> Conversation State
const semanticStep = RunnableLambda.from(
  async (state: OrchestratorInput & { language: string; normalizedMessage: string; history: MemoryTurn[] }) => {
    const semantic = await runSemanticChain({
      message: state.message,
      normalizedMessage: state.normalizedMessage,
      language: state.language,
      history: state.history
    });
    return { ...state, semantic };
  }
);

// Step 4: route on conversation state -- clarification vs. complete -> RAG chain
const routeStep = RunnableLambda.from(
  async (
    state: OrchestratorInput & {
      language: string;
      normalizedMessage: string;
      history: MemoryTurn[];
      semantic: SemanticResult;
    }
  ): Promise<OrchestratorResult> => {
    const { semantic, language, normalizedMessage } = state;

    if (SMALL_TALK_INTENTS.has(semantic.intent)) {
      return {
        language,
        normalizedMessage,
        semantic,
        stage: 'small_talk',
        answer: smallTalkReply(semantic.intent, language)
      };
    }

    if (semantic.supportIssue) {
      return { language, normalizedMessage, semantic, stage: 'support_issue' };
    }

    if (semantic.conversationState === 'needs_clarification') {
      return {
        language,
        normalizedMessage,
        semantic,
        stage: 'clarification',
        answer: CLARIFICATION_REPLIES[language] ?? CLARIFICATION_REPLIES.en
      };
    }

    // Complete conversation state -> RAG Chain -> Reranker -> Top KB Context.
    // This now includes unknown_query: instead of an immediate canned
    // reply, it still gets a real retrieval pass, so the fallback stays
    // knowledge-bound rather than generic.
    const retrievalQuery = [normalizedMessage, semantic.intent, semantic.category, semantic.service ?? '']
      .filter(Boolean)
      .join(' ');

    const hits = await runRagChain({ query: retrievalQuery, entities: semantic.entities });
    const topScore = hits[0]?.score ?? 0;

    return { language, normalizedMessage, semantic, stage: 'grounded', hits, topScore };
  }
);

export const orchestrator = RunnableSequence.from([languageStep, semanticStep, routeStep]);

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  return orchestrator.invoke(input);
}
