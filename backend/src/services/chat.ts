// src/services/chat.ts
//
// Entry point for a customer chat turn. The actual routing decision
// (small talk / clarification / support ticket / grounded RAG answer)
// now lives in the LangChain orchestrator:
//
//   src/langchain/orchestrator.ts   - language -> normalize -> semantic
//                                      chain -> conversation state routing
//   src/langchain/semanticChain.ts  - intent / service / entities, with
//                                      conversation memory for context
//                                      resolution ("I need a technician"
//                                      after an earlier problem message)
//   src/langchain/retrieval.ts      - hybrid vector+keyword RAG chain
//                                      with an explicit reranker step
//   src/langchain/answerChain.ts    - grounded answer LLM chain
//   src/langchain/memory.ts         - conversation state + memory
//
// This file keeps the parts that are intentionally NOT part of that
// orchestration: session id handling, support-ticket creation, and all
// Mongo persistence -- the "other connections" that were asked to stay
// untouched.

import crypto from 'node:crypto';

import { mongoDb } from '../db/mongo.js';
import { ChatRequest } from '../models/types.js';

import { runOrchestrator } from '../langchain/orchestrator.js';
import { runAnswerChain } from '../langchain/answerChain.js';
import { rememberMockTurn } from '../langchain/memory.js';
import { generate } from './huggingface.js';
import { createTicket } from './tickets.js';

import { env } from '../config/env.js';

const PAYMENT_WORDS =
  /payment|paid|transaction|पेमेंट|भुगतान|paisa|paise|पैसे|rakam|रकम|राशि|રકમ|પેમેન્ટ|ભુગતાન/i;

export async function chat(input: ChatRequest) {
  const sessionId = input.sessionId || crypto.randomUUID();

  // =========================================================
  // ORCHESTRATOR: language -> normalize -> semantic chain
  // (intent/service/entities/conversation state) -> route
  // =========================================================

  const routed = await runOrchestrator({
    sessionId,
    message: input.message
  });

  const { language, normalizedMessage, semantic, stage } = routed;

  let answer = '';
  let ticketCreated = false;
  let ticketId: string | undefined;
  let responseSources: Array<{ id: string; score: number }> = [];

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

    ticketCreated = true;
    ticketId = ticket.ticketId;

    const ticketPrompt = `
The customer reported a ${semantic.category} support issue.

Customer message:
${input.message}

Detected customer language:
${language}

A support ticket has already been created.

Ticket ID:
${ticket.ticketId}

Tell the customer that the ticket was created and that the support team
will assist within 24 hours.

Rules:
- Respond entirely in the detected customer language.
- Preserve the ticket ID exactly.
- Do not claim the issue is resolved.
- Do not invent ticket details.
- Keep the response concise.
- Return only the customer-facing answer.
`.trim();

    answer = await generate(ticketPrompt, language);
  }

  // =========================================================
  // GROUNDED (RAG Chain -> Reranker -> Grounded Answer LLM Chain)
  // Covers known intents with a knowledge match, and unknown_query --
  // the fallback stays knowledge-bound instead of a hardcoded sentence.
  // =========================================================

  else {
    const hits = routed.hits ?? [];
    const topScore = routed.topScore ?? 0;

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

    await db.collection('conversations').updateOne(
      { sessionId },
      {
        $setOnInsert: {
          sessionId,
          createdAt: new Date(),
          customerReference: input.customerReference
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
