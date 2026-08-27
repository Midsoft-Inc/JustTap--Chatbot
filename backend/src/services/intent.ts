// src/services/intent.ts

export type IntentResult = {
  intent: string;
  category: string;
  supportIssue: boolean;
  confidence: number;
};

type Rule = {
  intent: string;
  category: string;
  re: RegExp;
  supportIssue?: boolean;
};

/*
 * IMPORTANT:
 * Do not put specific services such as plumber, electrician,
 * carpenter, photographer, etc. here.
 *
 * Services are resolved from the knowledge dataset.
 */

const rules: Rule[] = [
  // =========================================================
  // GENERAL
  // =========================================================

  {
    intent: 'greeting',
    category: 'general',
    re: /^(hi|hello|hey|namaste|नमस्ते|नमस्कार|हाय|हॅलो)\b/iu
  },

  {
    intent: 'thanks',
    category: 'general',
    re: /(?:thanks|thank\s+you|धन्यवाद|शुक्रिया|आभार)/iu
  },

  {
    intent: 'goodbye',
    category: 'general',
    re: /(?:bye|goodbye|see\s+you|अलविदा|फिर\s+मिलेंगे|पुन्हा\s+भेटू)/iu
  },

  {
    intent: 'help',
    category: 'general',
    re: /(?:^|\s)(?:help|help\s+me|मदद|मदत|सहायता|सहाय्य)(?:\s|$)/iu
  },

  {
    intent: 'acknowledgement',
    category: 'general',
    re: /^(?:yes|yeah|yep|yup|ok|okay|alright|all\s+right|got\s+it|understood|sure|thanks|thank\s+you|ठीक|ठीक\s+है|ठीक\s+आहे|समजले|समजलं|बरं|बरं\s+आहे|हो|होय|धन्यवाद)$/iu
  },

  // =========================================================
  // COMPANY / JUSTTAP
  // =========================================================

  {
    intent: 'about_justtap',
    category: 'company',
    re: /(?:about\s+justtap|tell\s+me\s+about\s+justtap|justtap\s+के\s+बारे|justtap\s+बद्दल|justtap\s+विषयी)/iu
  },

  {
    intent: 'what_is_justtap',
    category: 'company',
    re: /(?:what\s+is\s+justtap|what's\s+justtap|justtap\s+क्या\s+है|justtap\s+काय\s+आहे)/iu
  },

  {
    intent: 'how_justtap_works',
    category: 'company',
    re: /(?:how\s+does\s+justtap\s+work|how\s+justtap\s+works|justtap\s+कैसे\s+काम|justtap\s+कसे\s+काम)/iu
  },

  {
    intent: 'justtap_services',
    category: 'company',
    re: /(?:justtap\s+services|services\s+on\s+justtap|justtap\s+पर\s+सेवाएं|justtap\s+वरील\s+सेवा)/iu
  },

  {
    intent: 'justtap_locations',
    category: 'company',
    re: /(?:where\s+is\s+justtap|justtap\s+locations|where\s+does\s+justtap\s+operate|justtap\s+कहाँ|justtap\s+कुठे)/iu
  },

  {
    intent: 'contact_justtap',
    category: 'company',
    re: /(?:contact\s+justtap|contact\s+support|justtap\s+contact|justtap\s+से\s+संपर्क|justtap\s+शी\s+संपर्क)/iu
  },

  {
    intent: 'justtap_support',
    category: 'company',
    re: /(?:justtap\s+support|support\s+from\s+justtap|justtap\s+सपोर्ट|justtap\s+मदद|justtap\s+मदत)/iu
  },

  {
    intent: 'general_justtap',
    category: 'general',
    re:
      /(?:\b(?:what\s+(?:is|does)\s+justtap|what\s+justtap\s+do|what\s+can\s+i\s+do\s+(?:with|in)\s+justtap|what\s+is\s+justtap\s+used\s+for|tell\s+me\s+about\s+justtap|how\s+does\s+justtap\s+work|how\s+justtap\s+works|how\s+can\s+i\s+use\s+justtap)\b|जस्टटैप\s+(?:क्या\s+है|क्या\s+करता\s+है|में\s+क्या\s+कर सकते|के\s+बारे\s+में)|JustTap\s+(?:काय\s+आहे|काय\s+करते|मध्ये\s+काय\s+करू\s+शकतो|बद्दल))/iu
  },

  // =========================================================
  // BOOKING
  // =========================================================

  {
    intent: 'how_to_book',
    category: 'booking',
    re:
      /(?:\b(?:how\s+(?:can\s+i|do\s+i)?\s+book|can\s+i\s+book|i\s+(?:want|need)\s+to\s+book|i\s+(?:want|need)\s+(?:a|an)\s+service|(?:need|want|looking\s+for)\s+(?:a\s+)?(?:service|someone)|(?:has|have)\s+to\s+book|please\s+book)\b|(?:बुक|बुकिंग|बुक\s+करना|बुक\s+करनी|सेवा\s+बुक|सेवा\s+कैसे\s+बुक|सेवा\s+बुक\s+करनी|मला\s+सेवा\s+बुक|मी\s+सेवा\s+बुक|मला\s+सेवा\s+हवी))/iu
  },

  {
    intent: 'cancel_booking',
    category: 'booking',
    re: /(?:cancel\s+(?:my\s+)?booking|cancel\s+(?:my\s+)?service|cancellation|how\s+to\s+cancel|बुकिंग\s*रद्द|बुकिंग\s*कॅन्सल|रद्द\s*करना|रद्द\s*करनी|रद्द\s*करायची)/iu
  },

  {
    intent: 'reschedule_booking',
    category: 'booking',
    re: /(?:reschedule\s+(?:my\s+)?booking|change\s+(?:my\s+)?booking|change\s+(?:the\s+)?booking\s+date|change\s+schedule|बुकिंग\s*बदल|तारीख\s*बदल|बुकिंग\s*की\s*तारीख|पुन्हा\s*शेड्यूल|पुन्हा\s*बुक|वेळ\s*बदल)/iu
  },

  // =========================================================
  // BOOKING PROBLEM
  // =========================================================

  {
    intent: 'booking_problem',
    category: 'booking',
    supportIssue: true,
    re: /(?:(?:booking|book|schedule).*(?:failed|fail|failure|problem|issue|error|not\s+working|cannot|can't)|(?:failed|failure|problem|issue|error).*(?:booking|book|schedule)|बुकिंग.*(?:समस्या|दिक्कत|एरर|फेल|काम\s*नहीं)|बुक.*(?:समस्या|दिक्कत|एरर|फेल|नहीं\s*हो)|बुकिंग.*(?:अडचण|त्रास|काम\s*होत\s*नाही))/iu
  },

  // =========================================================
  // SERVICE
  // =========================================================

  {
    intent: 'find_service',
    category: 'service',
    re: /(?:how\s+(?:can\s+i\s+)?(?:do\s+i\s+)?find\s+(?:a\s+)?service|how\s+(?:can\s+i\s+)?(?:do\s+i\s+)?search\s+(?:for\s+)?(?:a\s+)?service|find\s+(?:a\s+)?service|search\s+(?:for\s+)?(?:a\s+)?service|looking\s+for\s+(?:a\s+)?service|where\s+can\s+i\s+find\s+(?:a\s+)?service|service\s+find|सेवा\s*कैसे\s*(?:ढूंढ|खोज|मिल|तलाश)|सेवा\s*(?:ढूंढें|खोजें|तलाशें)|सेवा\s*कैसे\s*(?:मिलेगी|मिलती|ढूंढें|खोजें)|सेवा\s*कहाँ\s*(?:खोजें|ढूंढें|मिलेगी)|मुझे\s*सेवा\s*(?:कैसे|कहाँ)\s*(?:मिलेगी|खोजें|ढूंढें)|सेवा\s*शोध|सेवा\s*कशी\s*(?:शोध|शोधू|मिळेल)|सेवा\s*कुठे\s*(?:शोधू|मिळेल))/iu
  },

  {
    intent: 'service_category',
    category: 'service',
    re: /(?:service\s+category|which\s+category|what\s+category|which\s+type\s+of\s+service|किस\s*श्रेणी|कौनसी\s*श्रेणी|सेवा\s*श्रेणी|कोणत्या\s*श्रेणी|सेवा\s*प्रकार)/iu
  },

  {
    intent: 'service_price',
    category: 'service',
    re: /(?:price|cost|rate|charge|how\s+much|pricing|कितना|कितनी|कीमत|मूल्य|चार्ज|कितने\s*पैसे|किंमत|दर|किती\s*पैसे)/iu
  },

  {
    intent: 'service_provider',
    category: 'service',
    re: /(?:find\s+(?:a\s+)?provider|service\s+provider|provider\s+near|provider\s+in\s+(?:my\s+)?area|near\s+me|मेरे\s*पास|मेरे\s*क्षेत्र|सेवा\s*प्रदाता|प्रदाता\s*खोज|जवळ|आपल्या\s*भागात|सेवा\s*प्रदाता)/iu
  },

  {
    intent: 'service_location',
    category: 'service',
    re: /(?:service\s+location|where\s+is\s+(?:the\s+)?service|service\s+in\s+my\s+area|which\s+areas|कहाँ\s*सेवा|किस\s*क्षेत्र|मेरे\s*क्षेत्र\s*में|सेवा\s*कुठे|कोणत्या\s*भागात)/iu
  },

  {
    intent: 'service_availability',
    category: 'service',
    re: /(?:availability|when\s+is\s+(?:the\s+)?service\s+available|available\s+time|available\s+slot|उपलब्धता|कधी\s*उपलब्ध|उपलब्ध\s*वेळ|उपलब्ध\s*स्लॉट)/iu
  },

  {
    intent: 'service_available',
    category: 'service',
    re: /(?:is\s+(?:this\s+)?service\s+available|is\s+there\s+(?:a\s+)?service|do\s+you\s+have\s+(?:this\s+)?service|service\s+available|उपलब्ध|सेवा\s*उपलब्ध|क्या\s+सेवा\s+उपलब्ध|सेवा\s*मिळेल|उपलब्ध\s*आहे)/iu
  },

  // =========================================================
  // SERVICE PROBLEM
  // =========================================================

  {
    intent: 'service_problem',
    category: 'service',
    supportIssue: true,
    re: /(?:(?:service|provider|technician).*(?:problem|issue|bad|late|didn't\s+come|did\s+not\s+come|not\s+come)|(?:problem|issue).*(?:service|provider)|सेवा.*(?:समस्या|दिक्कत|खराब|नहीं\s*आली)|प्रदाता.*(?:नहीं\s*आया|देर|समस्या)|सेवा.*(?:अडचण|त्रास|खराब)|सर्विस.*(?:समस्या|खराब))/iu
  },

  // =========================================================
  // PROVIDER
  // =========================================================

  {
    intent: 'become_provider',
    category: 'provider',
    re: /(?:become\s+(?:a\s+)?provider|join\s+as\s+(?:a\s+)?provider|work\s+as\s+(?:a\s+)?provider|register\s+as\s+(?:a\s+)?provider|provider\s+बनना|प्रदाता\s*बनना|provider\s*बनायचे|सेवा\s*प्रदाता\s*बनायचे)/iu
  },

  {
    intent: 'provider_registration',
    category: 'provider',
    re: /(?:provider\s+registration|register\s+(?:as\s+)?provider|provider\s+signup|provider\s+account|प्रदाता\s*पंजीकरण|provider\s*registration|प्रदाता\s*नोंदणी)/iu
  },

  {
    intent: 'provider_documents',
    category: 'provider',
    re: /(?:provider\s+documents|documents\s+(?:for\s+)?provider|which\s+documents|provider\s+verification\s+documents|प्रदाता\s*दस्तावेज|provider\s*documents|प्रदाता\s*कागदपत्रे)/iu
  },

  {
    intent: 'provider_commission',
    category: 'provider',
    re: /(?:provider\s+commission|commission\s+for\s+provider|provider\s+fee|प्रदाता\s*कमीशन|provider\s*commission|प्रदाता\s*कमिशन)/iu
  },

  {
    intent: 'provider_payment',
    category: 'provider',
    re: /(?:provider\s+payment|when\s+provider\s+gets\s+paid|provider\s+payout|provider\s+earning|प्रदाता\s*भुगतान|provider\s*payment|प्रदाता\s*पैसे)/iu
  },

  {
    intent: 'provider_verification',
    category: 'provider',
    re: /(?:provider\s+verification|verify\s+(?:a\s+)?provider|provider\s+verified|प्रदाता\s*सत्यापन|provider\s*verification|प्रदाता\s*पडताळणी)/iu
  },

  // =========================================================
  // PAYMENT
  // =========================================================

  {
    intent: 'payment_failed',
    category: 'payment',
    supportIssue: true,
    re: /(?:payment\s+failed|payment\s+failure|transaction\s+failed|भुगतान\s*फेल|पेमेंट\s*फेल|पेमेंट\s*अयशस्वी)/iu
  },

  {
    intent: 'payment_refund',
    category: 'payment',
    supportIssue: true,
    re: /(?:refund|money\s+back|refund\s+status|पैसे\s*वापस|रिफंड|परतावा|पैसे\s*परत)/iu
  },

  {
    intent: 'payment_missing',
    category: 'payment',
    supportIssue: true,
    re: /(?:money\s+deducted|amount\s+deducted|payment\s+missing|money\s+not\s+received|पैसे\s*कटे|पैसे\s*नहीं\s*आए|रक्कम\s*कापली|पैसे\s*मिळाले\s*नाही)/iu
  },

  {
    intent: 'payment_problem',
    category: 'payment',
    supportIssue: true,
    re: /(?:(?:payment|paid|transaction|पेमेंट|भुगतान|paisa|paise|पैसे|amount|rakam|रकम|राशि|रक्कम|પેમેન્ટ|ભુગતાન).*(?:failed|fail|failure|problem|issue|error|stuck|pending|blocked|missing|not\s+confirmed|not\s+received|ruk|rukh|ruka|ruki|atak|atka|atki|nahi\s+hua|nahi\s+hui|रुक|रुका|रुकी|अटक|अटका|अटकी|समस्या|दिक्कत|परेशानी|फेल|असफल|एरर|અટકી|અટક્યું|અટકાઈ|સમસ્યા|દિક્કત|ફેલ|અસફળ)|(?:failed|fail|failure|problem|issue|error|stuck|pending|blocked|missing|not\s+confirmed|not\s+received|ruk|rukh|ruka|ruki|atak|atka|atki|समस्या|दिक्कत|परेशानी|અટકી|અટક્યું|સમસ્યા).*(?:payment|paid|transaction|पेमेंट|भुगतान|paisa|paise|पैसे|amount|rakam|रकम|राशि|रक्कम|પેમેન્ટ|ભુગતાન))/iu
  },
  {
    intent: 'payment_status',
    category: 'payment',
    re: /(?:payment\s+status|transaction\s+status|is\s+my\s+payment\s+successful|भुगतान\s*स्थिति|पेमेंट\s*स्टेटस|पेमेंट\s*यशस्वी\s*आहे\s*का)/iu
  },

  // =========================================================
  // SUPPORT
  // =========================================================

  {
    intent: 'support_request',
    category: 'support',
    supportIssue: true,
    re: /(?:contact\s+support|need\s+support|talk\s+to\s+support|support\s+help|create\s+(?:a\s+)?ticket|raise\s+(?:a\s+)?ticket|complaint|शिकायत|तक्रार|सपोर्ट\s*चाहिए|सपोर्ट\s*मदत|support\s*हवी|सहायता\s*चाहिए)/iu
  }
];

/**
 * Classify a user message.
 *
 * Service names are intentionally NOT hardcoded.
 * The service/entity is resolved from the knowledge dataset.
 */
export function classifyIntent(text: string): IntentResult {
  const normalized = text.trim();

  if (!normalized) {
    return {
      intent: 'unknown_query',
      category: 'general',
      supportIssue: false,
      confidence: 0.1
    };
  }

  for (const rule of rules) {
    if (rule.re.test(normalized)) {
      return {
        intent: rule.intent,
        category: rule.category,
        supportIssue: !!rule.supportIssue,
        confidence: 0.82
      };
    }
  }

  return {
    intent: 'unknown_query',
    category: 'general',
    supportIssue: false,
    confidence: 0.25
  };
}