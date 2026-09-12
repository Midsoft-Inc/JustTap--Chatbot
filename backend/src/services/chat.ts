
import crypto from 'node:crypto';

import { mongoDb } from '../db/mongo.js';
import { ChatRequest } from '../models/types.js';

import { runOrchestrator } from '../langchain/orchestrator.js';
import { runAnswerChain } from '../langchain/answerChain.js';
import { rememberMockTurn } from '../langchain/memory.js';
import { setCachedAnswer } from '../langchain/cache.js';
import { createTicket } from './tickets.js';

import { env } from '../config/env.js';

const PAYMENT_WORDS =
  /payment|paid|transaction|पेमेंट|भुगतान|paisa|paise|पैसे|rakam|रकम|राशि|રકમ|પેમેન્ટ|ભુગતાન/i;

// Ticket confirmation is a fixed, deterministic message -- only the ticket
// ID and language change. It never needs an LLM call: same structure every
// time, and a template also removes any risk of the model paraphrasing or
// mangling the ticket ID. This mirrors the small_talk/clarification reply
// pattern already used in langchain/orchestrator.ts.
const TICKET_CONFIRMATION: Record<string, (ticketId: string) => string> = {
  hi: (id) =>
    `आपकी शिकायत के लिए सपोर्ट टिकट बना दिया गया है। टिकट आईडी: ${id}. हमारी सपोर्ट टीम 24 घंटों के भीतर आपकी सहायता करेगी।`,
  mr: (id) =>
    `तुमच्या समस्येसाठी सपोर्ट तिकीट तयार करण्यात आले आहे. तिकीट आयडी: ${id}. आमची सपोर्ट टीम 24 तासांच्या आत मदत करेल.`,
  en: (id) =>
    `A support ticket has been created for your issue. Ticket ID: ${id}. Our support team will assist you within 24 hours.`
};

function ticketConfirmationReply(ticketId: string, language: string): string {
  const build = TICKET_CONFIRMATION[language] ?? TICKET_CONFIRMATION.en;
  return build(ticketId);
}

export async function chat(input: ChatRequest) {
  const turnStart = Date.now();
  const sessionId = input.sessionId || crypto.randomUUID();

  // =========================================================
  // ORCHESTRATOR: language -> normalize -> semantic chain
  // (intent/service/entities/conversation state) -> route
  // =========================================================

  const routed = await runOrchestrator({
    sessionId,
    message: input.message,
    responseLanguage: input.responseLanguage
  });

  const { language, normalizedMessage, semantic, stage } = routed;

  let answer = '';
  let ticketCreated = false;
  let ticketId: string | undefined;
  let responseSources: Array<{ id: string; score: number }> = [];
  const chatTimings: Record<string, number> = {};

  // =========================================================
  // SMALL TALK / CLARIFICATION
  // Pre-built reply already decided by the orchestrator's route step.
  // =========================================================

  if (stage === 'small_talk' || stage === 'clarification') {
    answer = routed.answer ?? '';
  }

  // =========================================================
  // SUPPORT ISSUE
  // Payment/support problems are routed to one ticket before any
  // knowledge retrieval, exactly as before -- this guarantees payment
  // problems reach support instead of going through RAG.
  // =========================================================

  else if (stage === 'support_issue') {
    const tTicket = Date.now();
    const ticket = await createTicket({
      conversationId: sessionId,
      customerReference: input.customerReference,
      category: semantic.category,
      subject: input.message.slice(0, 100),
      description: input.message,
      priority:
        semantic.category === 'payment' || PAYMENT_WORDS.test(input.message)
          ? 'high'
          : 'normal',
      assignedTo: null
    });
    chatTimings.ticketCreate = Date.now() - tTicket;

    ticketCreated = true;
    ticketId = ticket.ticketId;
    answer = ticketConfirmationReply(ticket.ticketId, language);
  }

  // =========================================================
  // GROUNDED (RAG Chain -> Reranker -> Grounded Answer LLM Chain)
  // Covers known intents with a knowledge match, and unknown_query --
  // the fallback stays knowledge-bound instead of a hardcoded sentence.
  // =========================================================

  else {
    const hits = routed.hits ?? [];
    const topScore = routed.topScore ?? 0;

    if (routed.answer) {
      // Cache hit from the orchestrator: skip retrieval-scoring/generation
      // entirely, this is already a previously-generated grounded answer.
      answer = routed.answer;
    } else {
      const tGenerate = Date.now();
      try {
        answer = await runAnswerChain({
          message: input.message,
          normalizedMessage,
          language,
          intent: semantic.intent,
          category: semantic.category,
          hits,
          topScore,
          minRelevanceScore: env.MIN_RELEVANCE_SCORE
        });
      } catch (error) {
        chatTimings.answerGenerate = Date.now() - tGenerate;
        // Hugging Face may temporarily reject inference (for example when
        // included credits are exhausted). Do not turn that provider failure
        // into a 502 or an invented answer. Return a deterministic,
        // language-correct safe fallback instead.
        const providerError = String(error);
        if (/402|depleted|credits|inference providers/i.test(providerError)) {
          const fallbacks: Record<string, string> = {
            hi: 'माफ़ कीजिए, अभी उत्तर तैयार करने में अस्थायी समस्या है। कृपया थोड़ी देर बाद फिर से प्रयास करें।',
            mr: 'क्षमस्व, सध्या उत्तर तयार करण्यात तात्पुरती अडचण आहे. कृपया थोड्या वेळाने पुन्हा प्रयत्न करा.',
            en: 'Sorry, there is a temporary problem preparing the answer. Please try again shortly.'
          };
          answer = fallbacks[language] ?? fallbacks.en;
        } else {
          throw error;
        }
      }
      chatTimings.answerGenerate = chatTimings.answerGenerate ?? Date.now() - tGenerate;

      // Cache the fresh answer for next time. Fire-and-forget: caching
      // is an optimization, the customer shouldn't wait on it, and a
      // write failure here must never affect the response they get.
      // (This one is safe to leave un-awaited even under the serverless
      // entry point in api/index.ts, unlike the message-log writes below
      // -- worst case here is simply a missed cache write, not a lost
      // customer-facing record.)
      // Cache only successful, grounded answers.
      // Known intents with at least one retrieved KB hit are cacheable even
      // when the reranker score is below MIN_RELEVANCE_SCORE. The score is
      // used to decide answer grounding, but requiring it here can prevent
      // otherwise valid FAQ answers (for example login) from ever being
      // written to the cache. Never cache the deterministic provider-error
      // fallback.
      const providerFallback =
        /temporary problem preparing the answer|अस्थायी समस्या|तात्पुरती अडचण/i.test(answer);

      if (
        !providerFallback &&
        semantic.intent !== 'unknown_query' &&
        hits.length > 0
      ) {
        try {
          // Do not make the customer wait for a cache write. setCachedAnswer
          // populates the local L1 cache synchronously, then persists the same
          // value to MongoDB for cross-device reuse.
          void setCachedAnswer(normalizedMessage, language, {
            answer,
            intent: semantic.intent,
            category: semantic.category
          })
            .then(() => {
              console.log('[CACHE] stored', {
                language,
                intent: semantic.intent,
                normalizedMessage
              });
            })
            .catch((cacheError) => {
              console.warn('[CACHE] store failed:', cacheError);
            });
        } catch (cacheError) {
          console.warn('[CACHE] store scheduling failed:', cacheError);
        }
      }
    }

    // Unknown questions must never expose retrieval results, even though
    // the fallback guidance above still draws on them internally.
    if (semantic.intent !== 'unknown_query') {
      responseSources = hits.map((hit) => ({ id: hit.id, score: hit.score }));
    }
  }

  // =========================================================
  // MEMORY + DATABASE
  // Unchanged Mongo connection/collections; only the stored message
  // shape gains `intent`/`service` fields so future turns can resolve
  // context (see langchain/memory.ts).
  // =========================================================

  if (env.CHATBOT_MODE !== 'mock') {
    const db = mongoDb();
    const tPersist = Date.now();

    await db.collection('conversations').updateOne(
      { sessionId },
      {
        $setOnInsert: {
          sessionId,
          createdAt: new Date(),
          customerReference: input.customerReference
        },
        $set: {
          responseLanguage: language
        }
      },
      { upsert: true }
    );

    await db.collection('messages').insertMany([
      {
        sessionId,
        role: 'user',
        content: input.message,
        language,
        intent: semantic.intent,
        service: semantic.service,
        createdAt: new Date()
      },
      {
        sessionId,
        role: 'assistant',
        content: answer,
        language,
        intent: semantic.intent,
        service: semantic.service,
        ticketCreated,
        ticketId,
        createdAt: new Date()
      }
    ]);
    chatTimings.persist = Date.now() - tPersist;
  } else {
    // Mock mode has no Mongo connection -- keep the in-process memory
    // buffer (langchain/memory.ts) fed so multi-turn context still works
    // for local/dev runs.
    const now = new Date();
    rememberMockTurn(sessionId, {
      role: 'user',
      content: input.message,
      intent: semantic.intent,
      service: semantic.service,
      createdAt: now
    });
    rememberMockTurn(sessionId, {
      role: 'assistant',
      content: answer,
      intent: semantic.intent,
      service: semantic.service,
      createdAt: now
    });
  }

  // =========================================================
  // RESPONSE
  // =========================================================

  // One consolidated line per turn: orchestrator stage timings (language
  // detection/translation, cache lookup, semantic chain, retrieval+rerank)
  // merged with this file's own stages (ticket creation, generation,
  // persistence), plus the true end-to-end total. This is what should be
  // checked first on any slow request instead of guessing which stage is
  // the bottleneck.
  console.log(
    '[TIMING]',
    JSON.stringify({
      sessionId,
      stage,
      totalMs: Date.now() - turnStart,
      ...routed.timings,
      ...chatTimings
    })
  );

  return {
    sessionId,
    language,
    intent: semantic.intent,
    answer,
    ticketCreated,
    ticketId,
    sources: responseSources
  };
}
