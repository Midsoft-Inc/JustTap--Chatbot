import fs from 'node:fs/promises';
import { connectMongo } from '../src/db/mongo.js';
import { saveKnowledge } from '../src/services/knowledge.js';
import { embed } from '../src/services/huggingface.js';
import { ensureCollection, upsertVector } from '../src/services/vector.js';
import { KnowledgeRecord } from '../src/models/types.js';

const file = process.argv[2] || 'knowledge/justtap_service_qa.json';
const records = JSON.parse(await fs.readFile(file, 'utf8')) as KnowledgeRecord[];
await connectMongo();
await ensureCollection();
for (const r of records) {
  const vector = await embed(`${r.question}\n${r.answer}\n${r.category}\n${r.sub_service ?? ''}\n${r.keywords.join(', ')}`);
  await saveKnowledge(r);
  await upsertVector(r, vector);
}
console.log(`Seeded ${records.length} records.`);
