// src/langchain/retrieval.ts

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { hybridSearch } from '../services/knowledge.js';
import { SearchHit } from '../models/types.js';
import { env } from '../config/env.js';

type RetrievalInput = {
  query: string;
  entities: Record<string, string>;
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

/**
 * Extract canonical service concepts from the retrieval query.
 * This is deliberately local and deterministic. It is a fallback for cases
 * where normalization produced an incomplete query but semantic classification
 * already supplied service/intent terms.
 */
function canonicalService(query: string): string | null {
  if (/(?:\bplumb(?:er|ing)\b|tap|faucet|sink|pipe|water\s+leak|leaking\s+pipe|toilet|drain|नल|नळ|पाइप|प्लंबर|प्लम्बिंग|नलसाजी)/iu.test(query)) {
    return 'plumber';
  }

  if (/(?:\belectric(?:ian|al)?\b|wiring|switch|socket|power\s+outlet|इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज)/iu.test(query)) {
    return 'electrician';
  }

  if (/(?:\bcarpent(?:er|ry)\b|door|furniture|cabinet|woodwork|सुतार|सुतारकाम)/iu.test(query)) {
    return 'carpenter';
  }

  if (/(?:\bbike\b|bicycle|motorbike|motorcycle|scooter|mechanic)/iu.test(query)) {
    return 'bike servicing';
  }

  return null;
}

function canonicalIntent(query: string): string | null {
  if (
    /how_to_book/i.test(query) ||
    /\b(?:book|booking|schedule)\b/iu.test(query) ||
    /बुक(?:िंग|िंग)?/u.test(query) ||
    /बुक\s*कर/iu.test(query) ||
    /सेवा\s*बुक/iu.test(query) ||
    /बुक\s*कराय/iu.test(query)
  ) {
    return 'how_to_book';
  }

  if (/service_price/i.test(query) || /\b(?:price|cost|rate|charge)\b/iu.test(query)) {
    return 'service_price';
  }

  if (/service_availability/i.test(query) || /\b(?:available|availability)\b/iu.test(query)) {
    return 'service_availability';
  }

  if (/service_provider/i.test(query) || /\bprovider(?:s)?\b/iu.test(query)) {
    return 'service_provider';
  }

  if (/cancel_booking/i.test(query) || /\bcancel(?:lation)?\b/iu.test(query)) {
    return 'cancel_booking';
  }

  if (/reschedule_booking/i.test(query) || /\breschedule\b/iu.test(query)) {
    return 'reschedule_booking';
  }

  return null;
}

const retrieveStep = RunnableLambda.from(
  async ({ query, entities }: RetrievalInput) => {
    const t0 = Date.now();

    // First attempt: use the complete query exactly as supplied by the
    // orchestrator. This preserves multilingual/native-language wording.
    let hits = await hybridSearch(query);

    // Deterministic second attempt: if the first retrieval misses, rebuild a
    // compact canonical query from the same text. This prevents a translation
    // or normalization variation from causing a known KB record to disappear.
    if (hits.length === 0) {
      const service =
        canonicalService(query) ??
        Object.values(entities)
          .map(String)
          .map((v) => v.toLowerCase())
          .find((v) =>
            ['plumber', 'electrician', 'carpenter', 'bike servicing'].includes(v)
          ) ??
        null;

      const intent = canonicalIntent(query);

      if (service || intent) {
        const fallbackQuery = [
          service ?? '',
          intent ?? '',
          intent === 'how_to_book' ? 'book booking schedule' : '',
          intent === 'service_price' ? 'price cost rate charge' : '',
          intent === 'service_availability' ? 'available availability' : '',
          intent === 'service_provider' ? 'provider providers' : ''
        ]
          .filter(Boolean)
          .join(' ');

        if (fallbackQuery && fallbackQuery !== query) {
          console.log('[RAG] canonical retrieval fallback', {
            originalQuery: query,
            fallbackQuery
          });
          hits = await hybridSearch(fallbackQuery);
        }
      }
    }

    console.log('[TIMING] retrieval.hybridSearch', Date.now() - t0, 'ms');
    console.log('[RAG] retrieved', {
      query,
      count: hits.length,
      top: hits[0]
        ? { id: hits[0].id, score: hits[0].score, intent: hits[0].intent, service: hits[0].sub_service }
        : null
    });

    return { query, entities, hits };
  }
);

const rerankStep = RunnableLambda.from(
  ({
    query,
    entities,
    hits
  }: {
    query: string;
    entities: Record<string, string>;
    hits: SearchHit[];
  }) => {
    const queryTokens = new Set(tokenize(query));

    for (const value of Object.values(entities)) {
      for (const t of tokenize(value)) queryTokens.add(t);
    }

    const service = canonicalService(query);
    const intent = canonicalIntent(query);

    const rescored = hits.map((hit) => {
      const hitText = [
        hit.question,
        hit.answer,
        hit.keywords.join(' '),
        hit.sub_service ?? '',
        hit.category,
        hit.intent
      ]
        .join(' ')
        .toLowerCase();

      const overlap = tokenize(hitText).filter((t) => queryTokens.has(t)).length;
      let score = Math.min(1, hit.score + Math.min(0.25, overlap * 0.03));

      // Never allow the reranker to undermine an already verified
      // deterministic service+intent match.
      if (
        service &&
        hit.sub_service &&
        hit.sub_service.toLowerCase() === service &&
        intent &&
        hit.intent === intent
      ) {
        score = Math.max(score, 0.99);
      }

      return { ...hit, score };
    });

    return rescored
      .sort((a, b) => (b.score - a.score) || a.id.localeCompare(b.id))
      .slice(0, env.TOP_K_FINAL);
  }
);

export const ragChain = RunnableSequence.from([
  retrieveStep,
  rerankStep
]);

export async function runRagChain(
  input: RetrievalInput
): Promise<SearchHit[]> {
  return ragChain.invoke(input);
}
