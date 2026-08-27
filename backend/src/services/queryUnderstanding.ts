// src/services/queryUnderstanding.ts

import { generate } from './huggingface.js';
import { getKnownServices, discoverServiceFromKnowledge } from './knowledge.js';

export type QueryUnderstanding = {
  intent:
    | 'service_booking'
    | 'service_need'
    | 'service_price'
    | 'service_provider'
    | 'payment_problem'
    | 'how_to_book'
    | 'knowledge'
    | 'unknown_query';
  service: string | null;
  entities: Record<string, string>;
  confidence: number;
  conversationState?: 'complete' | 'needs_clarification';
};

const ALLOWED = new Set([
  'service_booking',
  'service_need',
  'service_price',
  'service_provider',
  'payment_problem',
  'how_to_book',
  'knowledge',
  'unknown_query',
]);

function deterministic(text: string): QueryUnderstanding | null {
  const s = text.trim();
  if (!s) return null;

  // Relevant situation, but no explicit request yet.
  // Keep this small and generic: semantic understanding remains the main
  // mechanism; this rule only catches obvious problem statements.
  const carProblem =
    /\b(car|vehicle|auto)\b/i.test(s) &&
    /\b(damage|damaged|broken|breakdown|broke|stopped|not working|problem|issue|accident)\b/i.test(s);

  if (carProblem && !/\b(want|need|book|hire|find|get|repair|fix|mechanic|service)\b/i.test(s)) {
    return {
      intent: 'service_need',
      service: 'car mechanic',
      entities: { problem: 'car problem or damage' },
      confidence: .90,
      conversationState: 'needs_clarification'
    };
  }

  // Keep payment detection deterministic so support-ticket routing
  // does not depend on the LLM.
  const payment =
    /(?:payment|paid|transaction|पेमेंट|भुगतान|paisa|paise|पैसे|amount|rakam|रकम|રકમ|પેમેન્ટ|ભુગતાન)/i.test(s) &&
    /(?:failed|fail|failure|problem|issue|error|stuck|pending|blocked|missing|ruk|rukh|ruka|ruki|atak|atka|atki|nahi\s+(?:hua|hui)|रुक|अटक|समस्या|दिक्कत|અટકી|અટક્યું|સમस्या)/i.test(s);

  if (payment) {
    return {
      intent: 'payment_problem',
      service: null,
      entities: {},
      confidence: 0.98
    };
  }

  const booking =
    /(?:book|booking|hire|reserve|schedule|need\s+someone|want\s+someone|बुक|बुकिंग|बुक\s*कर|बुक\s*करना|बुक\s*करनी|बुक\s*कराय|बुक\s*करायची|book\s*kar|book\s*karna|book\s*karni|book\s*karay)/i.test(s);

  // Explicit service names.
  let service =
    /\b(plumber|plumbing)\b/i.test(s) ? 'plumbing' :
    /\b(electrician|electrical)\b/i.test(s) ? 'electrical' :
    /\b(carpenter|carpentry)\b/i.test(s) ? 'carpentry' :
    /\b(cleaner|cleaning|home\s*cleaning)\b/i.test(s) ? 'cleaning' :
    /\b(makeup|makeup\s*artist)\b/i.test(s) ? 'makeup' :
    /(?:प्लंबर|प्लम्बिंग|नलसाजी|नळ|प्लंबिंग)/u.test(s) ? 'plumbing' :
    /(?:इलेक्ट्रीशियन|इलेक्ट्रिशियन|बिजली|वीज)/u.test(s) ? 'electrical' :
    null;

  // Semantic/problem descriptions for common service categories.
  // The LLM below handles broader services; these aliases provide a
  // deterministic fallback for common natural-language descriptions.
  if (!service) {
    if (/(?:tap|faucet|sink|pipe|water\s+leak|leaking\s+pipe|toilet|drain)/i.test(s)) {
      service = 'plumbing';
    } else if (/(?:wiring|switch|socket|power\s+outlet|electrical\s+fault)/i.test(s)) {
      service = 'electrical';
    } else if (/(?:door|furniture|cabinet|woodwork)/i.test(s)) {
      service = 'carpentry';
    } else if (/(?:clean\s+my\s+home|house\s+cleaning|home\s+cleaning)/i.test(s)) {
      service = 'cleaning';
    } else if (/(?:bike|bick|bicycle|motorbike|motorcycle|scooter|two[-\s]?wheeler|cycle|mechanic)\s*(?:repair|fix|service|servicing|maintenance)?/i.test(s) ||
               /(?:repair|fix|service|servicing|maintenance)\s+(?:my\s+)?(?:bike|bick|bicycle|motorbike|motorcycle|scooter|two[-\s]?wheeler|cycle)/i.test(s)) {
      service = 'bike servicing';
    }
  }

  if (booking) {
    const problem =
      service === 'plumbing' && /(?:tap|faucet|sink|pipe|leak|toilet|drain)/i.test(s)
        ? 'tap/plumbing repair'
        : service === 'electrical' && /(?:wiring|switch|socket|power)/i.test(s)
          ? 'electrical repair'
          : service === 'carpentry' && /(?:door|furniture|cabinet|woodwork)/i.test(s)
            ? 'carpentry repair'
            : '';

    return {
      intent: 'service_booking',
      service,
      entities: problem ? { problem } : {},
      confidence: service ? 0.96 : 0.90
    };
  }

  // A problem statement without explicit booking language can still be
  // understood as a request for a relevant service.
  if (
    service &&
    /(?:fix|repair|broken|leak|leaking|not\s+working|problem|issue|need\s+help|service|maintenance)/i.test(s)
  ) {
    return {
      intent: 'service_booking',
      service,
      entities: { problem: s },
      confidence: 0.91
    };
  }

  return null;
}

function parse(text: string): QueryUnderstanding | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) return null;

  try {
    const x = JSON.parse(cleaned.slice(a, b + 1));

    const intent =
      typeof x.intent === 'string' && ALLOWED.has(x.intent)
        ? x.intent
        : 'unknown_query';

    const confidence =
      typeof x.confidence === 'number'
        ? Math.max(0, Math.min(1, x.confidence))
        : 0.5;

    const service =
      typeof x.service === 'string' && x.service.trim()
        ? x.service.trim().toLowerCase()
        : null;

    const entities: Record<string, string> = {};

    if (x.entities && typeof x.entities === 'object') {
      for (const [key, value] of Object.entries(x.entities)) {
        if (typeof value === 'string' && value.trim()) {
          entities[key] = value.trim();
        }
      }
    }

    return {
      intent,
      service,
      entities,
      confidence
    };
  } catch {
    return null;
  }
}

export async function understandQuery(text: string): Promise<QueryUnderstanding> {
  const d = deterministic(text);
  if (d) return d;

  // Common account-help intent: password/account access.
  // This is a narrow safety/control rule; the actual instructions come from RAG.
  if (/\b(pass(word)?|passwd|login|log[ -]?in|account|credential)\b/i.test(text) &&
      /\b(forgot|forget|forgotten|reset|recover|can't|cannot|lost|remember|access|problem|issue)\b/i.test(text)) {
    return {
      intent: 'knowledge',
      service: null,
      entities: { topic: 'account/help', issue: 'password or account access' },
      confidence: .94,
      conversationState: 'complete'
    };
  }

  let catalog: Array<{service:string; keywords:string[]}> = [];
  let discovered: string | null = null;
  try {
    catalog = await getKnownServices();
    discovered = await discoverServiceFromKnowledge(text);
  } catch {}

  const serviceCatalog = catalog
    .map(x => `${x.service} [${x.keywords.slice(0, 12).join(', ')}]`)
    .join('\n');

  const prompt = `Convert this JustTap customer message into JSON only:

{"intent":"service_booking | service_need | service_price | service_provider | payment_problem | how_to_book | knowledge | unknown_query","service":"canonical service name from the dataset or null","entities":{},"confidence":0.0,"conversationState":"complete | needs_clarification"}

Understand meaning, not exact wording.
If the customer describes a JustTap-relevant problem/situation but has not
yet asked for an action, use intent=service_need and conversationState=needs_clarification.
Do not invent services, prices, providers, availability, policies, or application actions.
If the message semantically describes a known service, use its canonical dataset service name.
Understand indirect wording, job roles, misspellings, and natural language.
Examples:
- "I am on the way and my car has damage" -> service_need, car mechanic, needs_clarification
- "I forgot my password" -> knowledge, account/help
- "I can't remember my password" -> knowledge, account/help
- "i an foget my passward" -> knowledge, account/help
- "how do I reset my password" -> knowledge, account/help
- "My car broke down" -> service_need, car mechanic, needs_clarification
- "I need a mechanic for my bike" -> service_booking, bike servicing
- "I need a software developer for my project" -> service_booking, software developer
- "My computer is not working, I need a technician" -> service_booking, computer repair technician
- "My car has broken down, I need a mechanic" -> service_booking, car mechanic

Known services from the JustTap knowledge dataset:
${serviceCatalog || '(none)'}

Likely service discovered directly from the dataset:
${discovered ?? 'none'}

Customer message:
${text}`.trim();

  try {
    const parsed = parse(await generate(prompt, 'en'));
    if (parsed) {
      if (discovered) {
        parsed.service = discovered;
        if (parsed.intent === 'unknown_query' || parsed.intent === 'how_to_book' || parsed.intent === 'knowledge') {
          parsed.intent = 'service_booking';
        }
        parsed.confidence = Math.max(parsed.confidence, .90);
      }
      return parsed;
    }
  } catch {}

  if (discovered) {
    return {intent:'service_booking',service:discovered,entities:{},confidence:.90};
  }
  return {intent:'unknown_query',service:null,entities:{},confidence:.2};
}
