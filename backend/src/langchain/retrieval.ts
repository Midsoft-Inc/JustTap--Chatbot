// src/langchain/retrieval.ts
//
// Diagram stage: RAG Chain -> Vector Search + Keyword Search -> Reranker
// -> Top KB Context.
//
// Vector + keyword retrieval already exists and is untouched
// (services/knowledge.ts hybridSearch, services/vector.ts, Qdrant/Mongo
// connections). This file adds the missing, explicit Reranker stage as
// its own step in a RunnableSequence, so retrieval is genuinely a
// two-stage pipeline instead of "one blended score and done."
//
// The reranker is a local lexical re-scorer (no new external service/
// connection): it boosts hits whose actual wording overlaps with the
// customer's message and any extracted entities (e.g. {"problem": "tap
// leaking"}), so a hit matching the customer's specific wording outranks
// one that only matched on a broad category via the vector/keyword blend
// alone.

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';

import { hybridSearch } from '../services/knowledge.js';
import { SearchHit } from '../models/types.js';

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

const retrieveStep = RunnableLambda.from(async ({ query, entities }: RetrievalInput) => {
  const hits = await hybridSearch(query);
  return { query, entities, hits };
});

const rerankStep = RunnableLambda.from(
  ({ query, entities, hits }: { query: string; entities: Record<string, string>; hits: SearchHit[] }) => {
    const queryTokens = new Set(tokenize(query));
    for (const value of Object.values(entities)) {
      for (const t of tokenize(value)) queryTokens.add(t);
    }

    const rescored = hits.map((hit) => {
      const hitText = `${hit.question} ${hit.answer} ${hit.keywords.join(' ')} ${hit.sub_service ?? ''} ${hit.category}`.toLowerCase();
      const overlap = tokenize(hitText).filter((t) => queryTokens.has(t)).length;
      const lexicalBoost = Math.min(0.25, overlap * 0.03);
      return { ...hit, score: Math.min(1, hit.score + lexicalBoost) };
    });

    return rescored.sort((a, b) => b.score - a.score);
  }
);

export const ragChain = RunnableSequence.from([retrieveStep, rerankStep]);

export async function runRagChain(input: RetrievalInput): Promise<SearchHit[]> {
  return ragChain.invoke(input);
}
