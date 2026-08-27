// src/services/language.ts

const marathiWords =
  /(?:^|[\s,।?!])(?:आहे|आहेत|मला|माझे|माझ्या|तुमचे|काय|कसे|कशी|कुठे|सेवा|सेवेसाठी|पाहिजे|हवी|हवे|करायचे|करायची|करायचा|बुकिंग|रद्द|पुन्हा|उपलब्ध|किंमत|पैसे|समस्या|मदत|तक्रार|मिळेल|करू)(?=$|[\s,।?!])/u;

const hindiWords =
  /(?:^|[\s,।?!])(?:क्या|कैसे|कैसी|कहाँ|कहां|मुझे|मेरा|मेरी|आपका|सेवा|चाहिए|करना|करनी|करने|बुकिंग|रद्द|उपलब्ध|कितना|कितनी|पैसे|समस्या|मदद|शिकायत|मिल|सकता|सकती|है|हूँ|हूं)(?=$|[\s,।?!])/u;

const romanMarathiStrong =
  /\b(?:majha|majhe|majhya|mala|ahet|aahe|karaychi|karayche|havi|have|pahije|kuthe|kashi|karu|sathi|sevesathi|takrar)\b/i;

const romanHindiStrong =
  /\b(?:mujhe|mujhko|mera|meri|aapka|kya|kaise|kahan|kahaan|chahiye|karna|karni|karne|kitna|kitni|sakta|sakti|hoon|hun|rukh|ruk|atak|paisa|paise)\b/i;

const scripts: Array<[string, RegExp]> = [
  ['bn', /[\u0980-\u09FF]/u],
  ['gu', /[\u0A80-\u0AFF]/u],
  ['pa', /[\u0A00-\u0A7F]/u],
  ['ta', /[\u0B80-\u0BFF]/u],
  ['te', /[\u0C00-\u0C7F]/u],
  ['kn', /[\u0C80-\u0CFF]/u],
  ['ml', /[\u0D00-\u0D7F]/u]
];

function detectDevanagariLanguage(text: string): string {
  const marathiCount = [
    'आहे', 'आहेत', 'मला', 'माझे', 'माझ्या', 'कशी',
    'करायचे', 'करायची', 'हवी', 'हवे', 'पाहिजे',
    'तुमचे', 'कुठे', 'मिळेल', 'करू'
  ].filter(word => text.includes(word)).length;

  const hindiCount = [
    'क्या', 'कैसे', 'कैसी', 'कहाँ', 'कहां', 'मुझे',
    'मेरा', 'मेरी', 'आपका', 'चाहिए', 'करना', 'करनी',
    'कितना', 'कितनी', 'है', 'हूँ', 'हूं', 'सकता', 'सकती'
  ].filter(word => text.includes(word)).length;

  if (marathiCount > hindiCount) return 'mr';
  if (hindiCount > marathiCount) return 'hi';
  if (marathiWords.test(text)) return 'mr';
  if (hindiWords.test(text)) return 'hi';
  return 'hi';
}

export function detectLanguage(text: string): string {
  const normalized = text.trim();
  if (!normalized) return 'en';

  if (/[\u0900-\u097F]/u.test(normalized)) {
    return detectDevanagariLanguage(normalized);
  }

  for (const [lang, regex] of scripts) {
    if (regex.test(normalized)) return lang;
  }

  const marathi = romanMarathiStrong.test(normalized);
  const hindi = romanHindiStrong.test(normalized);

  if (marathi && !hindi) return 'mr';
  if (hindi && !marathi) return 'hi';

  return 'en';
}
