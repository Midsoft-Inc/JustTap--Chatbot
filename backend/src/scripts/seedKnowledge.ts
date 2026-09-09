import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import { env } from "../config/env.js";

type KnowledgeRecord = {
  id: string;
  language: string;
  category: string;
  sub_category: string;
  sub_service: string | null;
  intent: string;
  question: string;
  answer: string;
  keywords: string[];
  action: string;
  priority: string;
};

async function seedKnowledge() {
  const client = new MongoClient(env.MONGODB_URI);

  try {
    await client.connect();

    const db = client.db(env.MONGODB_DB);
    const collection = db.collection<KnowledgeRecord>("knowledge");

    const filePath = path.resolve(
      process.cwd(),
      "knowledge",
      "knowledge.json"
    );

    console.log(`Loading knowledge from: ${filePath}`);

    const raw = fs.readFileSync(filePath, "utf8");
    const records: KnowledgeRecord[] = JSON.parse(raw);

    if (!Array.isArray(records)) {
      throw new Error("knowledge.json must contain an array");
    }

    console.log(`Found ${records.length} knowledge records`);

    // Remove only the old MongoDB test documents
    await collection.deleteMany({
      $or: [
        { type: "test" },
        { text: "MongoDB Atlas datastore test" }
      ]
    });

    // Insert/update every knowledge record
    for (const record of records) {
      await collection.updateOne(
        { id: record.id },
        { $set: record },
        { upsert: true }
      );
    }

    const count = await collection.countDocuments();

    console.log("=================================");
    console.log("Knowledge seed completed");
    console.log(`JSON records: ${records.length}`);
    console.log(`MongoDB documents: ${count}`);
    console.log("=================================");
  } finally {
    await client.close();
  }
}

seedKnowledge().catch((error) => {
  console.error("Knowledge seed failed:", error);
  process.exit(1);
});