import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { mongoDb } from '../db/mongo.js';
import { KnowledgeRecord, SearchHit } from '../models/types.js';
import { embed } from './huggingface.js';
import { vectorSearch } from './vector.js';
import { env } from '../config/env.js';

let mockKnowledgePromise: Promise<KnowledgeRecord[]> | null = null;

async function loadMockKnowledge(): Promise<KnowledgeRecord[]> {
  if (!mockKnowledgePromise) {
    const path = fileURLToPath(
      new URL('../../knowledge/justtap_service_qa.json', import.meta.url)
    );

    mockKnowledgePromise = readFile(path, 'utf8').then((text) => {
      const raw = JSON.parse(text) as Array<Record<string, unknown>>;
      return raw.map(normalizeRecord);
    });
  }

  return mockKnowledgePromise;
}

/**
 * Normalize keywords coming from JSON/CSV.
 */
function normalizeKeywords(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).filter(Boolean);
  }

  if (typeof value === 'string') {
    const valueTrimmed = value.trim();

    if (!valueTrimmed) {
      return [];
    }

    try {
      const parsed = JSON.parse(valueTrimmed);

      if (Array.isArray(parsed)) {
        return parsed.map(String).filter(Boolean);
      }
    } catch {
      // Continue with separator parsing.
    }

    return valueTrimmed
      .split(/[,|;]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

/**
 * Normalize knowledge records so CSV/JSON data
 * always has the same internal structure.
 */
function normalizeRecord(
  raw: Record<string, unknown>
): KnowledgeRecord {
  return {
    id: String(raw.id ?? ''),
    language: String(raw.language ?? 'en'),
    category: String(raw.category ?? ''),
    sub_service:
      raw.sub_service == null ? null : String(raw.sub_service),
    intent: String(raw.intent ?? 'unknown_query'),
    audience:
      raw.audience == null ? undefined : String(raw.audience),
    location:
      raw.location == null ? null : String(raw.location),
    question: String(raw.question ?? raw.text ?? ''),
    answer: String(raw.answer ?? ''),
    keywords: normalizeKeywords(raw.keywords),
    source:
      raw.source == null ? undefined : String(raw.source),
    metadata:
      raw.metadata && typeof raw.metadata === 'object'
        ? (raw.metadata as Record<string, unknown>)
        : undefined
  };
}

/**
 * Multilingual aliases.
 *
 * The knowledge base can remain English.
 * These aliases connect user-language words
 * to the canonical English concepts in the dataset.
 */
const multilingualAliases: Record<string, string[]> = {
  // Booking
  book: [
    'book',
    'booking',
    'schedule',
    'बुक',
    'बुकिंग',
    'बुक करना',
    'बुकिंग करना',
    'बुकिंग कैसे',
    'सेवा बुक',
    'सेवा कैसे बुक',
    'कशी बुक',
    'बुक करायची',
    'सेवा बुक करायची'
  ],

  // Plumbing
  plumber: [
    'plumber',
    'plumbing',
    'pipe',
    'प्लंबर',
    'प्लम्बिंग',
    'पाइप',
    'नलसाजी',
    'नळ',
    'tap',
    'faucet',
    'sink',
    'pipe',
    'water leak',
    'leaking pipe',
    'toilet',
    'drain',
    'tap repair',
    'plumber service',
    'प्लंबरची सेवा',
    'प्लंबिंग सेवा',
    'नल',
    'पाइप',
    'पाइप लीक'
  ],

  // Electrician
  electrician: [
    'electrician',
    'electrical',
    'electric',
    'इलेक्ट्रीशियन',
    'इलेक्ट्रिशियन',
    'बिजली',
    'बिजली वाला',
    'वीज',
    'इलेक्ट्रिक'
  ],

  // Service
  service: [
    'service',
    'services',
    'सेवा',
    'सेवाएं',
    'सर्विस',
    'सेवा उपलब्ध'
  ],

  // Provider
  provider: [
    'provider',
    'providers',
    'service provider',
    'प्रदाता',
    'सेवा प्रदाता',
    'सर्विस प्रोव्हायडर'
  ],

  // Price
  price: [
    'price',
    'cost',
    'rate',
    'charge',
    'कीमत',
    'मूल्य',
    'किंमत',
    'दर',
    'पैसे'
  ],

  // Availability
  available: [
    'available',
    'availability',
    'उपलब्ध',
    'मिल सकता',
    'मिलती है',
    'मिळेल',
    'उपलब्ध आहे'
  ],

  // Cancel
  cancel: [
    'cancel',
    'cancellation',
    'रद्द',
    'रद्द करना',
    'बुकिंग रद्द',
    'रद्द करायची'
  ],

  // Reschedule
  reschedule: [
    'reschedule',
    'change booking',
    'change date',
    'तारीख बदल',
    'बुकिंग बदल',
    'पुन्हा बुक',
    'पुन्हा शेड्यूल'
  ]
};

/**
 * Expand a multilingual query into canonical concepts.
 */
function expandQuery(query: string): string[] {
  const normalized = query.toLowerCase();

  const terms = new Set<string>();

  for (const [canonical, aliases] of Object.entries(
    multilingualAliases
  )) {
    if (
      aliases.some((alias) =>
        normalized.includes(alias.toLowerCase())
      )
    ) {
      terms.add(canonical);

      for (const alias of aliases) {
        terms.add(alias.toLowerCase());
      }
    }
  }

  return [...terms];
}

/**
 * Extract useful tokens from a query.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

/**
 * Calculate relevance score.
 *
 * Multilingual aliases are used so Hindi/Marathi
 * queries can match the English knowledge dataset.
 */
function scoreRecord(
  record: KnowledgeRecord,
  query: string
): number {
  const queryLower = query.toLowerCase();

  const queryTokens = tokenize(query);

  const expandedTerms = expandQuery(query);

  // Canonical service terms are stronger evidence than generic words such
  // as "service", "book", or "need". This is important for queries such as
  // "I need someone to fix my tap" -> plumbing.
  const canonicalService: 
  | 'plumber'
  | 'electrician'
  | 'carpenter'
  | 'bike servicing'
  | null =
  /(?:\bplumbing\b|\bplumber\b|tap|faucet|sink|pipe|water\s+leak|leaking\s+pipe|toilet|drain|नल|पाइप)/iu.test(query)
    ? 'plumber'
    : /(?:\belectrical\b|\belectrician\b|wiring|switch|socket|power\s+outlet|इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज)/iu.test(query)
      ? 'electrician'
      : /(?:\bcarpentry\b|\bcarpenter\b|door|furniture|cabinet|woodwork)/iu.test(query)
        ? 'carpenter'
        : /(?:\bbike\b|\bbick\b|bicycle|bike\s*(?:repair|service|servicing)|motorbike|motorcycle|scooter|mechanic)/iu.test(query)
          ? 'bike servicing'
          : null;

  const searchableText = [
    record.question,
    record.answer,
    record.category,
    record.sub_service ?? '',
    record.intent,
    ...record.keywords
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;

  // ---------------------------------------------------------
  // Direct token matches
  // ---------------------------------------------------------

  const directMatches = queryTokens.filter((token) =>
    searchableText.includes(token)
  ).length;

  if (queryTokens.length > 0) {
    score +=
      (directMatches / queryTokens.length) * 0.35;
  }

  // ---------------------------------------------------------
  // Multilingual/canonical matches
  // ---------------------------------------------------------

  const canonicalMatches = expandedTerms.filter((term) =>
    searchableText.includes(term)
  ).length;

  if (expandedTerms.length > 0) {
    score +=
      (canonicalMatches / expandedTerms.length) * 0.45;
  }

  // Strong boost when the record belongs to the service implied by the
  // customer problem. Prefer the canonical sub_service/category/keywords
  // instead of inventing a new service.
  if (canonicalService) {
    const recordServiceText = [
      record.sub_service ?? '',
      record.category,
      record.keywords.join(' ')
    ].join(' ').toLowerCase();

    if (
      (canonicalService === 'plumber' &&
        /plumb|plumber|tap|faucet|sink|pipe|toilet|drain|नल|पाइप/u.test(recordServiceText)) ||
      (canonicalService === 'electrician' &&
        /electrical|electrician|wiring|switch|socket|power|बिजली|वीज/u.test(recordServiceText)) ||
      (canonicalService === 'carpenter' &&
        /carpent|carpentry|door|furniture|cabinet|woodwork/u.test(recordServiceText)) ||
      (canonicalService === 'bike servicing' &&
        /bike\s*servicing|bike\s*service|bicycle|motorbike|motorcycle|scooter|mechanic|automobile/u.test(recordServiceText))
    ) {
      score += 0.35;
    }
  }

  // ---------------------------------------------------------
  // Keyword matches
  // ---------------------------------------------------------

  const keywordMatches = record.keywords.filter(
    (keyword) =>
      queryLower.includes(keyword.toLowerCase()) ||
      expandedTerms.some((term) =>
        keyword.toLowerCase().includes(term)
      )
  ).length;

  const semanticProblemMatches = [
    ['tap', /tap|faucet|नल/iu],
    ['pipe', /pipe|पाइप/iu],
    ['sink', /sink/iu],
    ['leak', /leak|leaking|लीक/iu],
    ['toilet', /toilet/iu],
    ['drain', /drain/iu],
    ['bike', /bike|bick|bicycle|motorbike|motorcycle|scooter|mechanic/iu]
  ].filter(([_, queryRegex]) =>
    (queryRegex as RegExp).test(query)
  ).filter(([_, recordRegex]) =>
    (recordRegex as RegExp).test(searchableText)
  ).length;

  const semanticKeywordBonus = Math.min(semanticProblemMatches, 3) * 0.08;
  score += semanticKeywordBonus;

  score += Math.min(keywordMatches, 3) / 3 * 0.20;

  // ---------------------------------------------------------
  // Intent-specific boosting
  // ---------------------------------------------------------

  if (
    expandedTerms.includes('book') &&
    record.intent === 'how_to_book'
  ) {
    score += 0.30;
  }

  if (
    expandedTerms.includes('cancel') &&
    record.intent === 'cancel_booking'
  ) {
    score += 0.30;
  }

  if (
    expandedTerms.includes('reschedule') &&
    record.intent === 'reschedule_booking'
  ) {
    score += 0.30;
  }

  if (
    expandedTerms.includes('price') &&
    record.intent === 'service_price'
  ) {
    score += 0.25;
  }

  if (
    expandedTerms.includes('available') &&
    record.intent === 'service_availability'
  ) {
    score += 0.25;
  }

  if (
    expandedTerms.includes('provider') &&
    record.intent === 'service_provider'
  ) {
    score += 0.25;
  }

  return Math.min(1, score);
}

/**
 * Save knowledge to MongoDB in production.
 */
export async function saveKnowledge(
  record: KnowledgeRecord
): Promise<void> {
  if (env.CHATBOT_MODE === 'mock') {
    return;
  }

  await mongoDb()
    .collection<KnowledgeRecord>('knowledge')
    .updateOne(
      { id: record.id },
      { $set: record },
      { upsert: true }
    );
}

/**
 * Keyword search.
 */
export async function keywordSearch(
  query: string,
  limit = env.TOP_K_KEYWORD
): Promise<SearchHit[]> {
  // ---------------------------------------------------------
  // MOCK MODE
  // ---------------------------------------------------------

  if (env.CHATBOT_MODE === 'mock') {
    const docs = await loadMockKnowledge();

    return docs
      .map((document) => ({
        ...document,
        score: scoreRecord(document, query),
        sourceType: 'keyword' as const
      }))
      .filter((document) => document.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  // ---------------------------------------------------------
  // PRODUCTION MODE
  // ---------------------------------------------------------

  const tokens = tokenize(query)
    .slice(0, 20);

  if (!tokens.length) {
    return [];
  }

  const regex = new RegExp(
    tokens.map(escapeRegex).join('|'),
    'i'
  );

  const docs = await mongoDb()
    .collection<KnowledgeRecord>('knowledge')
    .find({
      $or: [
        { question: regex },
        { answer: regex },
        { keywords: regex },
        { sub_service: regex },
        { category: regex }
      ]
    })
    .limit(limit)
    .toArray();

  return docs.map((document, index) => ({
    ...normalizeRecord(
      document as unknown as Record<string, unknown>
    ),
    score: Math.max(
      0.5,
      1 - index / Math.max(limit, 1)
    ),
    sourceType: 'keyword' as const
  }));
}

/**
 * Hybrid vector + keyword retrieval.
 */

export async function getKnownServices(): Promise<Array<{service:string; keywords:string[]}>> {
  let docs: KnowledgeRecord[];
  if (env.CHATBOT_MODE === 'mock') {
    docs = await loadMockKnowledge();
  } else {
    docs = await mongoDb().collection<KnowledgeRecord>('knowledge')
      .find({ sub_service: { $ne: null } }).toArray();
  }
  const map = new Map<string, Set<string>>();
  for (const raw of docs) {
    const r = normalizeRecord(raw as unknown as Record<string, unknown>);
    if (!r.sub_service) continue;
    const service = r.sub_service.trim().toLowerCase();
    if (!service) continue;
    if (!map.has(service)) map.set(service, new Set());
    const s = map.get(service)!;
    s.add(service);
    for (const kw of r.keywords) s.add(kw.toLowerCase());
    if (r.question) s.add(r.question.toLowerCase());
  }
  return [...map.entries()].map(([service, keywords]) => ({service, keywords:[...keywords]}));
}

export async function discoverServiceFromKnowledge(query: string): Promise<string | null> {
  const q = query.toLowerCase();
  const services = await getKnownServices();
  let best: {service:string; score:number} | null = null;
  for (const item of services) {
    let score = q.includes(item.service) ? 1 : 0;
    for (const kw of item.keywords) {
      if (kw.length >= 2 && q.includes(kw)) score = Math.max(score, Math.min(.95, kw.length/20));
    }
    const qt = tokenize(q);
    const kt = tokenize(item.service + ' ' + item.keywords.join(' '));
    const overlap = qt.filter(t => kt.includes(t)).length;
    score += Math.min(.5, overlap*.15);
    if (!best || score > best.score) best={service:item.service,score};
  }
  return best && best.score >= .20 ? best.service : null;
}

export async function hybridSearch(
  query: string
): Promise<SearchHit[]> {
  // ---------------------------------------------------------
  // MOCK MODE
  // ---------------------------------------------------------

  if (env.CHATBOT_MODE === 'mock') {
    return keywordSearch(
      query,
      env.TOP_K_FINAL
    );
  }

  // ---------------------------------------------------------
  // PRODUCTION MODE
  // ---------------------------------------------------------

  const [vector, keyword] = await Promise.all([
    embed(query),
    keywordSearch(query)
  ]);

  const vectorHits = await vectorSearch(vector);

  const map = new Map<string, SearchHit>();

  for (const hit of vectorHits) {
    map.set(hit.id, {
      ...hit,
      score: hit.score * 0.65
    });
  }

  for (const hit of keyword) {
    const existing = map.get(hit.id);

    if (existing) {
      existing.score += hit.score * 0.35;
    } else {
      map.set(hit.id, {
        ...hit,
        score: hit.score * 0.35
      });
    }
  }

  return [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, env.TOP_K_FINAL);
}

/**
 * Escape regex special characters.
 */
function escapeRegex(value: string): string {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
}