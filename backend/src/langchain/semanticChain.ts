
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
  'service_overview',
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

function canonicalServiceFromCatalog(value: string | null, catalog: Array<{ service: string; keywords: string[] }>): string | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().toLowerCase();
  return catalog.find((item) => item.service.trim().toLowerCase() === normalized)?.service ?? null;
}

function canonicalServiceExplicitlyMentioned(value: string | null, message: string): boolean {
  if (!value?.trim()) return false;
  const queryWords = new Set(
    message.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  );
  const serviceWords = value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return serviceWords.length > 0 && serviceWords.every((word) => queryWords.has(word));
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }

    for (let j = 0; j <= b.length; j++) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}

function isLikelyTypoMatch(queryWord: string, serviceWord: string): boolean {
  if (queryWord.length < 4 || serviceWord.length < 4) return false;

  const distance = levenshteinDistance(queryWord, serviceWord);
  const maxDistance = serviceWord.length <= 5 ? 1 : 2;

  return distance <= maxDistance;
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

    // Fast path for login/account-access questions. These are deterministic
    // knowledge requests, so don't spend an LLM call on intent classification.
    if (
      /\\b(?:login|log[ -]?in|sign[ -]?in|signin)\\b/i.test(s) &&
      /(?:\\b(?:how|can|do|access|help)\\b|kaise|kese|kare|karo|karu|karna|कर|लॉगिन|लॉग इन|साइन इन)/iu.test(s)
    ) {
      return {
        input,
        rule,
        understood: {
          intent: 'knowledge',
          service: null,
          entities: { topic: 'login', action: 'login to JustTap' },
          confidence: 0.99,
          conversationState: 'complete'
        } as LlmUnderstanding
      };
    }

    // Service overview is a deterministic KB intent. Do not ask the LLM to
    // invent or select individual services for a complete overview request.
    if (rule.intent === 'service_overview' || rule.intent === 'justtap_services') {
      return {
        input,
        rule,
        understood: {
          intent: 'service_overview',
          service: null,
          entities: {},
          confidence: 0.99,
          conversationState: 'complete'
        } as LlmUnderstanding
      };
    }

    let catalog: Array<{ service: string; keywords: string[] }> = [];
    let discovered: string | null = null;
    try {
      catalog = await getKnownServices();

      // Booking service resolution is deterministic and KB-bound.
      // Never let semantic discovery or the LLM invent a service.
      if (rule.intent === 'how_to_book') {
        const normalizedWords = new Set(
          s
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean)
        );

        const tokenize = (value: string): string[] =>
          value
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean);

        // Match a canonical service when either its complete name is present
        // or a distinctive service token is present. This handles:
        //   "book plumber"       -> Plumber
        //   "book painter"       -> Painter
        //   "book mechanic"      -> Bike Mechanic + Car Mechanic
        // while keeping generic "book a service" generic.
        const serviceMatches = catalog
          .map(({ service }) => {
            const serviceWords = tokenize(service);
            if (!serviceWords.length) return null;

            const allWordsPresent = serviceWords.every((word) => normalizedWords.has(word));
            if (allWordsPresent) return { service, score: serviceWords.length + 10 };

            const distinctiveMatches = serviceWords.filter((word) =>
              normalizedWords.has(word) && !['service', 'services'].includes(word)
            ).length;

            return distinctiveMatches > 0
              ? { service, score: distinctiveMatches }
              : null;
          })
          .filter((item): item is { service: string; score: number } => Boolean(item));

        // Typo-tolerant service matching. Only use this when an exact
        // canonical match was not found. A typo may resolve to a canonical
        // KB service, but it must never create a new service name.
        if (serviceMatches.length === 0) {
          const ignoredBookingWords = new Set([
            'i', 'we', 'want', 'need', 'would', 'like', 'can', 'could',
            'how', 'what', 'to', 'a', 'an', 'the', 'me', 'my', 'for',
            'please', 'book', 'booking', 'service', 'services', 'justtap',
            'app', 'application', 'in', 'on', 'from', 'get', 'hire',
            'find', 'do', 'you', 'is', 'it', 'this', 'that'
          ]);

          const targetWords = [...normalizedWords].filter(
            (word) => !ignoredBookingWords.has(word)
          );

          const typoMatches = catalog
            .map(({ service }) => {
              const serviceWords = tokenize(service).filter(
                (word) => !['service', 'services'].includes(word)
              );

              let matchedWords = 0;
              for (const queryWord of targetWords) {
                if (serviceWords.some((serviceWord) => isLikelyTypoMatch(queryWord, serviceWord))) {
                  matchedWords++;
                }
              }

              return matchedWords > 0
                ? { service, score: matchedWords }
                : null;
            })
            .filter((item): item is { service: string; score: number } => Boolean(item));

          serviceMatches.push(...typoMatches);
        }

        const maxScore = serviceMatches.length
          ? Math.max(...serviceMatches.map((item) => item.score))
          : 0;

        const explicitlyMentionedServices = serviceMatches
          .filter((item) => item.score === maxScore)
          .map((item) => item.service);

        if (explicitlyMentionedServices.length === 1 && maxScore > 0) {
          discovered = explicitlyMentionedServices[0];
        } else if (explicitlyMentionedServices.length > 1) {
          return {
            input,
            rule,
            understood: {
              intent: 'how_to_book',
              service: null,
              entities: {
                service_options: explicitlyMentionedServices.join(' | ')
              },
              confidence: 0.99,
              conversationState: 'needs_clarification'
            } as LlmUnderstanding
          };
        } else {
          // If the customer supplied a booking target that is not in the KB,
          // do not turn it into generic booking and do not invent a service.
          const bookingTargetWords = s
            .toLowerCase()
            .split(/[^\p{L}\p{N}]+/u)
            .filter(Boolean)
            .filter((word) =>
              !new Set([
                'i', 'we', 'want', 'need', 'would', 'like', 'can', 'could',
                'how', 'what', 'to', 'a', 'an', 'the', 'me', 'my', 'for',
                'please', 'book', 'booking', 'service', 'services', 'justtap',
                'app', 'application', 'in', 'on', 'from', 'get', 'hire',
                'find', 'do', 'you', 'is', 'it', 'this', 'that'
              ]).has(word)
            );

          if (bookingTargetWords.length > 0) {
            return {
              input,
              rule,
              understood: {
                intent: 'how_to_book',
                service: null,
                entities: {
                  unknown_service: bookingTargetWords.join(' ')
                },
                confidence: 0.99,
                conversationState: 'needs_clarification'
              } as LlmUnderstanding
            };
          }

          // No service target at all: keep the generic booking flow.
          return {
            input,
            rule,
            understood: {
              intent: 'how_to_book',
              service: null,
              entities: {},
              confidence: 0.99,
              conversationState: 'complete'
            } as LlmUnderstanding
          };
        }
      } else {
        discovered = await discoverServiceFromKnowledge(s);
      }
    } catch (error) {
      console.warn('[SEMANTIC] Service discovery failed:', error);
    }

    const explicitServiceRequest =
      /\b(?:i|we)\s+(?:need|want|require)\b/i.test(s) ||
      /\b(?:book|hire|find|get|repair|fix)\b/i.test(s) ||
      /(?:मुझे|चाहिए|बुक|करवाना|करना है|हवी|बुक करायची)/u.test(s);

    // A generic booking question such as "How can I book a service?" must
    // not inherit an arbitrary service discovered from generic booking words.
    // Only treat the discovered service as explicit when its canonical name
    // is actually present in the current normalized question.
    const normalizedWords = s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    const discoveredServiceWords = discovered
      ? discovered.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
      : [];

    const explicitServiceMentioned =
      discoveredServiceWords.length > 0 &&
      discoveredServiceWords.every((word) => normalizedWords.includes(word));


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
    if (
      discovered &&
      explicitServiceRequest &&
      (rule.intent !== 'how_to_book' || explicitServiceMentioned)
    ) {
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

{"intent":"service_booking | service_need | service_price | service_provider | service_overview | payment_problem | how_to_book | knowledge | unknown_query","service":"canonical service name from the dataset or null","entities":{},"confidence":0.0,"conversationState":"complete | needs_clarification"}

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

    // The LLM is never authoritative for service identity. If it returns a
    // service, accept it only when that exact canonical service exists in the
    // JustTap catalogue. For booking requests, the service must also be
    // explicitly supported by the current question.
    if (understood) {
      const llmCanonicalService = canonicalServiceFromCatalog(understood.service, catalog);
      const bookingIntent =
        understood.intent === 'service_booking' ||
        understood.intent === 'how_to_book' ||
        rule.intent === 'how_to_book';

      if (bookingIntent && llmCanonicalService && !canonicalServiceExplicitlyMentioned(llmCanonicalService, s)) {
        understood.service = null;
      } else {
        understood.service = llmCanonicalService;
      }

      if (discovered && explicitServiceRequest && canonicalServiceExplicitlyMentioned(discovered, s)) {
        understood.service = discovered;
        if (['unknown_query', 'how_to_book', 'knowledge'].includes(understood.intent)) {
          understood.intent = 'service_booking';
        }
        understood.confidence = Math.max(understood.confidence, 0.9);
      }
    }

    // Deterministic generic-booking behavior is authoritative.
    if (
      rule.intent === 'how_to_book' &&
      (!understood || understood.conversationState !== 'needs_clarification') &&
      !canonicalServiceExplicitlyMentioned(discovered, s)
    ) {
      understood = {
        intent: 'how_to_book',
        service: null,
        entities: {},
        confidence: 0.99,
        conversationState: 'complete'
      };
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
