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

const STOPWORDS = new Set([
  'a','an','the','is','are','am','i','me','my','we','our','you','your','to','for','of','on','in','at',
  'with','and','or','tell','about','please','can','could','would','want','need','like','how','what',
  'where','when','do','does','did','give','get','just','it','this','that','also','so','not','be','has',
  'have','had','will','shall','if','then','than','there','their','they','them','him','her','his',
  // The app's own name appears in nearly every KB record's answer text
  // (they're all JustTap app FAQs), so on its own it's not a useful
  // signal for which record is actually relevant -- without this, a
  // fully generic query like "tell me about justtap" would still get a
  // 0.40 base-score match against almost every record in the dataset.
  'justtap'
]);

/**
 * Extract useful tokens from a query, filtering out common filler words
 * (stopwords) so a query like "tell me about justtap" scores based on
 * "justtap" alone rather than getting noisy partial credit from "tell",
 * "me", and "about" matching against unrelated records too.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Calculate relevance score.
 *
 * Multilingual aliases are used so Hindi/Marathi
 * queries can match the English knowledge dataset.
 */
function scoreRecord(record: KnowledgeRecord, query: string): number {
  const q = query.toLowerCase().trim();
  const tokens = tokenize(q);
  const expanded = expandQuery(q);
  const searchable = [
    record.question, record.answer, record.category,
    record.sub_service ?? '', record.intent, ...record.keywords
  ].join(' ').toLowerCase();

  const question = record.question.toLowerCase().trim();
  if (question && q === question) return 1;
  if (question.length >= 8 && (question.includes(q) || q.includes(question))) return 0.98;

  // Real word-boundary matching, not substring matching -- "me" must not
  // count as a match just because the record's text contains "sometimes".
  const searchableTokens = new Set(tokenize(searchable));

  let score = 0;
  const direct = tokens.filter(t => searchableTokens.has(t)).length;
  if (tokens.length) score += (direct / tokens.length) * 0.40;

  for (const canonical of Object.keys(multilingualAliases)) {
    if (expanded.includes(canonical) && searchable.includes(canonical)) score += 0.20;
  }

  const service =
    /(?:\bplumb(?:er|ing)\b|tap|faucet|sink|pipe|water\s+leak|leaking\s+pipe|toilet|drain|नल|नळ|पाइप|प्लंबर|प्लम्बिंग|नलसाजी)/iu.test(q) ? 'plumber' :
    /(?:\belectric(?:ian|al)?\b|wiring|switch|socket|power\s+outlet|इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज)/iu.test(q) ? 'electrician' :
    /(?:\bcarpent(?:er|ry)\b|door|furniture|cabinet|woodwork|सुतार|सुतारकाम)/iu.test(q) ? 'carpenter' :
    /(?:\bbike\b|bicycle|motorbike|motorcycle|scooter|mechanic)/iu.test(q) ? 'bike servicing' : null;

  if (service) {
    const st = [record.sub_service ?? '', record.category, ...record.keywords,
      record.question, record.answer].join(' ').toLowerCase();
    const rx = service === 'plumber' ? /plumb|tap|faucet|sink|pipe|toilet|drain|नल|नळ|पाइप|प्लंबर|प्लम्बिंग|नलसाजी/u :
      service === 'electrician' ? /electrical|electrician|wiring|switch|socket|power|इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज/u :
      service === 'carpenter' ? /carpent|door|furniture|cabinet|woodwork|सुतार/u :
      /bike\s*servic|bicycle|motorbike|motorcycle|scooter|mechanic/u;
    if (rx.test(st)) score += 0.30;
  }

  if (expanded.includes('book') && record.intent === 'how_to_book') score += 0.30;
  if (expanded.includes('cancel') && record.intent === 'cancel_booking') score += 0.30;
  if (expanded.includes('reschedule') && record.intent === 'reschedule_booking') score += 0.30;
  if (expanded.includes('price') && record.intent === 'service_price') score += 0.25;
  if (expanded.includes('available') && record.intent === 'service_availability') score += 0.25;
  if (expanded.includes('provider') && record.intent === 'service_provider') score += 0.25;

  const kw = record.keywords.filter(k =>
    q.includes(k.toLowerCase()) ||
    expanded.some(t => k.toLowerCase().includes(t) || t.includes(k.toLowerCase()))
  ).length;
  score += Math.min(0.20, kw * 0.07);
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
export async function keywordSearch(query: string, limit = env.TOP_K_KEYWORD): Promise<SearchHit[]> {
  if (env.CHATBOT_MODE === 'mock') {
    return (await loadMockKnowledge()).map(d => ({
      ...d, score: scoreRecord(d, query), sourceType: 'keyword' as const
    })).filter(h => h.score > 0).sort((a,b) => b.score-a.score).slice(0, limit);
  }

  const q = query.trim().toLowerCase();
  if (!q) return [];
  const collection = mongoDb().collection<KnowledgeRecord>('knowledge');
  const expanded = expandQuery(q);

  const service =
    /(?:\bplumb(?:er|ing)\b|tap|faucet|sink|pipe|water\s+leak|leaking\s+pipe|toilet|drain|नल|नळ|पाइप|प्लंबर|प्लम्बिंग|नलसाजी)/iu.test(q) ? 'plumber' :
    /(?:\belectric(?:ian|al)?\b|wiring|switch|socket|power\s+outlet|इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज)/iu.test(q) ? 'electrician' :
    /(?:\bcarpent(?:er|ry)\b|door|furniture|cabinet|woodwork|सुतार|सुतारकाम)/iu.test(q) ? 'carpenter' :
    /(?:\bbike\b|bicycle|motorbike|motorcycle|scooter|mechanic)/iu.test(q) ? 'bike servicing' : null;

  const booking = expanded.includes('book') ||
    /\b(?:book|booking|schedule)\b/iu.test(q) ||
    /बुक(?:िंग|िंग)?/u.test(q) || /बुक\s*कर/iu.test(q) ||
    /सेवा\s*बुक/iu.test(q) || /बुक\s*कराय/iu.test(q);

  if (service && booking) {
    const exact = await collection.find({
      intent: 'how_to_book',
      sub_service: { $regex: `^${escapeRegex(service)}$`, $options: 'i' }
    }).limit(limit).toArray();
    if (exact.length) return exact.map(d => ({
      ...normalizeRecord(d as unknown as Record<string, unknown>), score: 1, sourceType: 'keyword' as const
    }));

    const rx = new RegExp(escapeRegex(service), 'iu');
    const fallback = await collection.find({
      intent: 'how_to_book',
      $or: [{keywords: rx}, {question: rx}, {answer: rx}, {sub_service: rx}]
    }).limit(limit).toArray();
    if (fallback.length) return fallback.map(d => ({
      ...normalizeRecord(d as unknown as Record<string, unknown>), score: 1, sourceType: 'keyword' as const
    }));
  }

  const terms = [...new Set([...tokenize(q), ...expanded.filter(t => t.length > 1)])].slice(0, 40);
  if (!terms.length) return [];
  const rx = new RegExp(terms.map(escapeRegex).join('|'), 'iu');
  const docs = await collection.find({
    $or: [{question: rx}, {answer: rx}, {keywords: rx}, {sub_service: rx}, {category: rx}, {intent: rx}]
  }).limit(Math.max(limit * 5, 20)).toArray();

  return docs.map(d => {
    const r = normalizeRecord(d as unknown as Record<string, unknown>);
    return {...r, score: scoreRecord(r, q), sourceType: 'keyword' as const};
  }).filter(h => h.score > 0)
    .sort((a,b) => (b.score-a.score) || a.id.localeCompare(b.id))
    .slice(0, limit);
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

export async function hybridSearch(query: string): Promise<SearchHit[]> {
  if (env.CHATBOT_MODE === 'mock') return keywordSearch(query, env.TOP_K_FINAL);

  // Deterministic KB retrieval first; embeddings are only the semantic fallback.
  const keyword = await keywordSearch(query);
  const strong = keyword.filter(h => h.score >= 0.90);
  if (strong.length) return strong.slice(0, env.TOP_K_FINAL);

  try {
    const vector = await embed(query);
    const vectorHits = await vectorSearch(vector);
    const map = new Map<string, SearchHit>();

    for (const h of vectorHits) map.set(h.id, {...h, score: Math.min(1, h.score * 0.65)});
    for (const h of keyword) {
      const old = map.get(h.id);
      if (old) old.score = Math.min(1, old.score + h.score * 0.35);
      else map.set(h.id, {...h, score: Math.min(1, h.score * 0.35)});
    }
    return [...map.values()].sort((a,b) => (b.score-a.score) || a.id.localeCompare(b.id))
      .slice(0, env.TOP_K_FINAL);
  } catch {
    // Never lose usable KB results because the embedding provider is unavailable.
    return keyword.slice(0, env.TOP_K_FINAL);
  }
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