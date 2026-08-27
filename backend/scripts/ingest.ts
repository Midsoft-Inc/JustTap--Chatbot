import fs from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import pdf from 'pdf-parse';
import { connectMongo } from '../src/db/mongo.js';
import { saveKnowledge } from '../src/services/knowledge.js';
import { embed } from '../src/services/huggingface.js';
import { ensureCollection, upsertVector } from '../src/services/vector.js';
import { KnowledgeRecord } from '../src/models/types.js';

const input = process.argv[2];
if (!input) throw new Error('Usage: npm run ingest -- <file.csv|file.json|file.pdf>');

await connectMongo();
await ensureCollection();

const ext = path.extname(input).toLowerCase();
const raw = await fs.readFile(input);
let records: KnowledgeRecord[] = [];

if (ext === '.csv') {
  const rows = parse(raw, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];
  records = rows.map((r, i) => ({
    id: r.id || `import_${i + 1}`,
    language: r.language || 'en',
    category: r.category || 'general',
    sub_service: r.sub_service || null,
    intent: r.intent || 'unknown_query',
    audience: r.audience || 'customer',
    location: r.location || null,
    question: r.question || r.text || '',
    answer: r.answer || '',
    keywords: parseKeywords(r.keywords),
    source: path.basename(input),
    metadata: { urgency: r.urgency || undefined }
  }));
} else if (ext === '.json') {
  const parsed = JSON.parse(raw.toString('utf8'));
  records = (Array.isArray(parsed) ? parsed : parsed.records) as KnowledgeRecord[];
} else if (ext === '.pdf') {
  const data = await pdf(raw);
  const chunks = chunk(data.text, 1200, 200);
  records = chunks.map((text, i) => ({
    id: `${path.basename(input, ext)}_${i + 1}`,
    language: 'en', category: 'document', sub_service: null, intent: 'document_information',
    audience: 'customer', location: null, question: text.slice(0, 300), answer: text,
    keywords: [], source: path.basename(input), metadata: { sourceType: 'pdf' }
  }));
} else throw new Error('Supported formats: CSV, JSON, PDF');

let done = 0;
for (const record of records) {
  if (!record.question && !record.answer) continue;
  const text = `${record.question}\n${record.answer}\n${record.category}\n${record.sub_service ?? ''}\n${record.keywords.join(', ')}`;
  const vector = await embed(text);
  await saveKnowledge(record);
  await upsertVector(record, vector);
  done++;
  if (done % 25 === 0) console.log(`Indexed ${done}/${records.length}`);
}
console.log(`Indexed ${done} records.`);

function parseKeywords(value?: string) {
  if (!value) return [];
  try { const x = JSON.parse(value); if (Array.isArray(x)) return x.map(String); } catch {}
  return value.split(',').map(s => s.trim()).filter(Boolean);
}
function chunk(text: string, size: number, overlap: number) {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size - overlap) out.push(text.slice(i, i + size));
  return out;
}
