// src/langchain/semanticChain.ts
//
// Diagram stage: Semantic LLM Chain -> Intent / Service / Entities ->
// Conversation State.
//
// This replaces the ad-hoc "classifyIntent() then maybe understandQuery()"
// branching that used to live inline in chat.ts with a single composed
// LangChain RunnableSequence:
//
//   1. deterministicStep  - existing regex rules (services/intent.ts),
//                            cheap and reliable for greetings, payment
//                            problems, provider/company questions, etc.
//   2. semanticStep       - for the intents rules genuinely can't resolve
//                            (booking/need/unknown/knowledge), ask the LLM
//                            for intent + service + entities +
//                            conversationState, grounded in the dataset's
//                            actual service catalog and the last few turns
//                            of conversation.
//   3. mergeStep          - combine both into one SemanticResult.

import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';

import { classifyIntent, IntentResult } from '../services/intent.js';
import { getKnownServices, discoverServiceFromKnowledge } from '../services/knowledge.js';
import { generate } from '../services/huggingface.js';
import { MemoryTurn, formatTurnsForPrompt } from './memory.js';

export type SemanticResult = {
  intent: string;
  category: string;
  service: string | null;
  entities: Record<string, string>;
  supportIssue: boolean;
  confidence: number;
  conversationState: 'complete' | 'needs_clarification';
};

type SemanticInput = {
  message: string;
  normalizedMessage: string;
  language: string;
  history: MemoryTurn[];
};

const ALLOWED_INTENTS = new Set([
  'service_booking',
  'service_need',
  'service_price',
  'service_provider',
  'payment_problem',
  'how_to_book',
  'knowledge',
  'unknown_query'
]);

// Intents where the regex layer alone is not enough to know the service,
// entities, or whether the conversation is complete or needs a follow-up.
const NEEDS_SEMANTIC = new Set([
  'unknown_query',
  'how_to_book',
  'service_booking',
  'service_need',
  'knowledge'
]);

type LlmUnderstanding = {
  intent: string;
  service: string | null;
  entities: Record<string, string>;
  confidence: number;
  conversationState: 'complete' | 'needs_clarification';
};

function parseLlmJson(text: string): LlmUnderstanding | null {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');

  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a < 0 || b <= a) return null;

  try {
    const x = JSON.parse(cleaned.slice(a, b + 1));

    const entities: Record<string, string> = {};
    if (x.entities && typeof x.entities === 'object') {
      for (const [key, value] of Object.entries(x.entities)) {
        if (typeof value === 'string' && value.trim()) entities[key] = value.trim();
      }
    }

    return {
      intent: typeof x.intent === 'string' && ALLOWED_INTENTS.has(x.intent) ? x.intent : 'unknown_query',
      service: typeof x.service === 'string' && x.service.trim() ? x.service.trim().toLowerCase() : null,
      entities,
      confidence: typeof x.confidence === 'number' ? Math.max(0, Math.min(1, x.confidence)) : 0.5,
      conversationState: x.conversationState === 'needs_clarification' ? 'needs_clarification' : 'complete'
    };
  } catch {
    return null;
  }
}

const deterministicStep = RunnableLambda.from(async (input: SemanticInput) => {
  const rule: IntentResult = classifyIntent(input.normalizedMessage);
  return { input, rule };
});

const semanticStep = RunnableLambda.from(
  async ({ input, rule }: { input: SemanticInput; rule: IntentResult }) => {
    if (!NEEDS_SEMANTIC.has(rule.intent)) {
      return { input, rule, understood: null as LlmUnderstanding | null };
    }

    // Deterministic semantic fast paths. These run BEFORE the LLM so an
    // obvious service request can never be downgraded to unknown_query by
    // model JSON/parsing variability. The canonical service is still read
    // from the actual JustTap knowledge catalogue -- it is not invented.
    const s = input.normalizedMessage.trim();

    let catalog: Array<{ service: string; keywords: string[] }> = [];
    let discovered: string | null = null;
    try {
      catalog = await getKnownServices();
      discovered = await discoverServiceFromKnowledge(s);
    } catch (error) {
      console.warn('[SEMANTIC] Service discovery failed:', error);
    }

    const explicitServiceRequest =
      /\b(?:i|we)\s+(?:need|want|require)\b/i.test(s) ||
      /\b(?:book|hire|find|get|repair|fix)\b/i.test(s) ||
      /(?:मुझे|चाहिए|बुक|करवाना|करना है|हवी|बुक करायची)/u.test(s);

    const problemWithoutAction =
      /\b(?:car|vehicle|auto)\b/i.test(s) &&
      /\b(?:damage|damaged|broken|breakdown|broke|stopped|not working|problem|issue|accident)\b/i.test(s) &&
      !explicitServiceRequest;

    if (problemWithoutAction) {
      const carService = catalog.find((x) =>
        /car\s+mechanic/i.test(x.service)
      )?.service ?? null;

      return {
        input,
        rule,
        understood: {
          intent: 'service_need',
          service: carService,
          entities: { problem: 'car problem or damage' },
          confidence: carService ? 0.98 : 0.90,
          conversationState: 'needs_clarification'
        } as LlmUnderstanding
      };
    }

    // CRITICAL FIX: "I need a plumber" is a service request even when the
    // regex classifier did not match the exact wording. Resolve the service
    // from the real KB and route it as service_booking. Do not let the LLM
    // turn this into unknown_query.
    if (discovered && explicitServiceRequest) {
      return {
        input,
        rule,
        understood: {
          intent: 'service_booking',
          service: discovered,
          entities: { service: discovered },
          confidence: 0.99,
          conversationState: 'complete'
        } as LlmUnderstanding
      };
    }

    // Account/password help is routed to knowledge (RAG), not the LLM's
    // free-form judgment, so this narrow intent doesn't depend on the
    // model correctly reading a short, often misspelled message.
    if (
      /\b(pass(word)?|passwd|login|log[ -]?in|account|credential)\b/i.test(s) &&
      /\b(forgot|forget|forgotten|reset|recover|can't|cannot|lost|remember|access|problem|issue)\b/i.test(s)
    ) {
      return {
        input,
        rule,
        understood: {
          intent: 'knowledge',
          service: null,
          entities: { topic: 'account/help', issue: 'password or account access' },
          confidence: 0.94,
          conversationState: 'complete'
        } as LlmUnderstanding
      };
    }

    const serviceCatalog = catalog
      .map((x) => `${x.service} [${x.keywords.slice(0, 12).join(', ')}]`)
      .join('\n');

    const prompt = `Convert this JustTap customer message into JSON only:

{"intent":"service_booking | service_need | service_price | service_provider | payment_problem | how_to_book | knowledge | unknown_query","service":"canonical service name from the dataset or null","entities":{},"confidence":0.0,"conversationState":"complete | needs_clarification"}

Understand meaning, not exact wording. Use the recent conversation below to
resolve references such as "I need a technician" following an earlier
message that already described the specific problem.

If the customer describes a JustTap-relevant problem/situation but has not
yet asked for an action, use intent=service_need and
conversationState=needs_clarification.

Do not invent services, prices, providers, availability, policies, or
application actions. If the message semantically describes a known
service, use its canonical dataset service name.

Recent conversation:
${formatTurnsForPrompt(input.history)}

Known services from the JustTap knowledge dataset:
${serviceCatalog || '(none)'}

Likely service discovered directly from the dataset:
${discovered ?? 'none'}

Customer message:
${input.message}`.trim();

    let understood: LlmUnderstanding | null = null;
    try {
      understood = parseLlmJson(await generate(prompt, 'en'));
    } catch {}

    if (discovered) {
      if (understood) {
        understood.service = discovered;
        if (['unknown_query', 'how_to_book', 'knowledge'].includes(understood.intent)) {
          understood.intent = 'service_booking';
        }
        understood.confidence = Math.max(understood.confidence, 0.9);
      } else {
        understood = {
          intent: 'service_booking',
          service: discovered,
          entities: {},
          confidence: 0.9,
          conversationState: 'complete'
        };
      }
    }

    return { input, rule, understood };
  }
);

const mergeStep = RunnableLambda.from(
  ({
    rule,
    understood
  }: {
    input: SemanticInput;
    rule: IntentResult;
    understood: LlmUnderstanding | null;
  }): SemanticResult => {
    // The LLM result is only allowed to override the deterministic
    // classification once it clears a real confidence bar and actually
    // resolved to something -- otherwise the rule-based result (which is
    // authoritative for greetings, payment problems, provider/company
    // questions, etc.) stands.
    if (understood && understood.confidence >= 0.85 && understood.intent !== 'unknown_query') {
      const intent = understood.intent;
      const category =
        intent === 'how_to_book' || intent === 'service_booking'
          ? 'booking'
          : intent.startsWith('service_')
            ? 'service'
            : intent === 'payment_problem'
              ? 'payment'
              : 'general';

      return {
        intent,
        category,
        service: understood.service,
        entities: understood.entities,
        supportIssue: intent === 'payment_problem' || rule.supportIssue,
        confidence: understood.confidence,
        conversationState: understood.conversationState
      };
    }

    return {
      intent: rule.intent,
      category: rule.category,
      service: understood?.service ?? null,
      entities: understood?.entities ?? {},
      supportIssue: rule.supportIssue,
      confidence: rule.confidence,
      conversationState: 'complete'
    };
  }
);

export const semanticChain = RunnableSequence.from([deterministicStep, semanticStep, mergeStep]);

export async function runSemanticChain(input: SemanticInput): Promise<SemanticResult> {
  return semanticChain.invoke(input);
}
