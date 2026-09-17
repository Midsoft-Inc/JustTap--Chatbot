import { mongoDb } from '../db/mongo.js';

export interface MostAskedQuestion {
  question: string;
  count: number;
}

interface MessageDocument {
  role?: string;
  content?: string;
  language?: string;
  intent?: string;
  service?: string;
  createdAt?: Date;
}

interface QuestionGroup {
  key: string;
  question: string;
  count: number;
  lastAskedAt: Date;
}

const STOP_WORDS = new Set([
  // English
  'a',
  'an',
  'the',
  'is',
  'are',
  'am',
  'was',
  'were',
  'do',
  'does',
  'did',
  'can',
  'could',
  'would',
  'should',
  'will',
  'what',
  'which',
  'how',
  'where',
  'when',
  'why',
  'who',
  'please',
  'tell',
  'me',
  'about',
  'of',
  'for',
  'to',
  'in',
  'on',
  'my',
  'your',
  'i',
  'we',
  'you',
  'it',
  'this',
  'that',

  // Hindi / Roman Hindi
  'kya',
  'kaise',
  'kaisi',
  'kahan',
  'kahaan',
  'kab',
  'kyun',
  'mujhe',
  'mera',
  'meri',
  'mere',
  'aapka',
  'aapki',
  'aapke',
  'hai',
  'hain',
  'ho',
  'karna',
  'karni',
  'karne',
  'ke',
  'ki',
  'ka',
  'se',
  'mein',
  'me',
  'par',
  'mila',
  'milega',
  'sakta',
  'sakti',
  'chahiye',

  // Roman Marathi
  'majha',
  'majhe',
  'majhya',
  'mala',
  'maza',
  'mazya',
  'tumcha',
  'tumchi',
  'tumche',
  'ahe',
  'aahe',
  'ahet',
  'kay',
  'kase',
  'kashi',
  'kuthe',
  'kadhe',
  'karaycha',
  'karaychi',
  'karayche',
  'karu',
  'havi',
  'have',
  'pahije',
  'sathi'
]);

function normalizeLanguage(language?: string): string {
  return (language || 'en').trim().toLowerCase().split(/[-_]/)[0];
}

function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeQuestion(text: string): string {
  const cleaned = cleanText(text);

  const words = cleaned
    .split(' ')
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word));

  return words.join(' ');
}

function buildGroupKey(message: MessageDocument): string {
  const language = normalizeLanguage(message.language);
  const intent = (message.intent || 'unknown').trim().toLowerCase();
  const service = (message.service || '').trim().toLowerCase();

  const normalized = normalizeQuestion(message.content || '');

  /*
   * Keep language, intent and service in the key.
   *
   * This prevents unrelated questions from different intents/services
   * from being merged just because they contain similar words.
   */
  return [
    language,
    intent,
    service,
    normalized
  ].join('|');
}

function cleanDisplayQuestion(question: string): string {
  return question.replace(/\s+/g, ' ').trim();
}

export async function getMostAskedQuestions(
  limit = 3
): Promise<MostAskedQuestion[]> {
  const db = mongoDb();

  const messages = await db
    .collection<MessageDocument>('messages')
    .find({
      role: 'user',
      content: {
        $exists: true,
        $type: 'string'
      }
    })
    .sort({
      createdAt: -1
    })
    .limit(10000)
    .toArray();

  const groups = new Map<string, QuestionGroup>();

  for (const message of messages) {
    const content = cleanDisplayQuestion(message.content || '');

    if (!content) {
      continue;
    }

    const normalized = normalizeQuestion(content);

    if (!normalized) {
      continue;
    }

    const key = buildGroupKey(message);
    const createdAt =
      message.createdAt instanceof Date
        ? message.createdAt
        : new Date(0);

    const existing = groups.get(key);

    if (existing) {
      existing.count += 1;

      if (createdAt > existing.lastAskedAt) {
        existing.lastAskedAt = createdAt;
      }
    } else {
      groups.set(key, {
        key,
        question: content,
        count: 1,
        lastAskedAt: createdAt
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return (
        b.lastAskedAt.getTime() -
        a.lastAskedAt.getTime()
      );
    })
    .slice(0, Math.max(1, limit))
    .map((group) => ({
      question: group.question,
      count: group.count
    }));
}