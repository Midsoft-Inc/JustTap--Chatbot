import React, {
  useEffect,
  useRef,
  useState
} from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const API = (
  (import.meta as any).env?.VITE_API_URL ||
  'http://localhost:8080'
).replace(/\/$/, '');

type Lang = 'en' | 'hi';

const LANGS: Record<Lang, { label: string; flag: string }> = {
  en: { label: 'English', flag: '🌐' },
  hi: { label: 'हिंदी', flag: '🇮🇳' }
};

const T: Record<Lang, any> = {
  en: {
    type: 'Type your question...',
    send: 'Send',
    yes: 'Yes',
    no: 'No',
    welcome: 'Welcome to Genie 👋',
    subtitle: 'How can we help you today?',
    ticket: 'Would you like to create a support ticket?',
    contact: 'Let our team contact you',
    submit: 'Submit request',
    name: 'Your name',
    phone: 'Phone number',
    location: 'Location',
    requirement: 'What do you need?',
    newChat: 'New chat',
    assistantTag: 'Your JustTap Assistant',
    supportBadge: 'JustTap Support',
    online: 'Online',
    saveChat: 'Save Chat',
    thinking: 'Genie is typing…',
    helpful: 'Was this helpful?',
    backToLatest: 'Back to latest',
    notSupported: 'Voice input is not supported in this browser.',
    listening: "I'm listening...",
    noSpeech: 'I could not hear you. Please try again.',
    voiceFailed: 'Voice input failed. Please try again.',
    connectError: 'Support is temporarily unavailable. Please try again.',
    thankYou: 'Thank you. Your request has been received and our team will contact you.',
    secureFooter: '🔒 Secure • Reliable • JustTap',
    emojiTitle: 'Emoji',
    gifTitle: 'GIF'
  },
  hi: {
    type: 'अपना सवाल लिखें...',
    send: 'भेजें',
    yes: 'हाँ',
    no: 'नहीं',
    welcome: 'Genie में आपका स्वागत है 👋',
    subtitle: 'आज हम आपकी कैसे मदद कर सकते हैं?',
    ticket: 'क्या आप सपोर्ट टिकट बनाना चाहते हैं?',
    contact: 'हमारी टीम आपसे संपर्क करे',
    submit: 'अनुरोध भेजें',
    name: 'आपका नाम',
    phone: 'फोन नंबर',
    location: 'स्थान',
    requirement: 'आपको क्या चाहिए?',
    newChat: 'नई चैट',
    assistantTag: 'आपका JustTap सहायक',
    supportBadge: 'JustTap सपोर्ट',
    online: 'ऑनलाइन',
    saveChat: 'चैट सेव करें',
    thinking: 'Genie टाइप कर रहा है…',
    helpful: 'क्या इससे मदद मिली?',
    backToLatest: 'नया संदेश देखें',
    notSupported: 'इस ब्राउज़र में वॉइस इनपुट समर्थित नहीं है।',
    listening: 'मैं सुन रहा हूँ...',
    noSpeech: 'मैं आपकी आवाज़ नहीं सुन पाया। कृपया फिर से प्रयास करें।',
    voiceFailed: 'वॉइस इनपुट विफल रहा। कृपया फिर से प्रयास करें।',
    connectError: 'मैं अभी सहायता सेवा से कनेक्ट नहीं कर पा रहा हूँ। कृपया कुछ देर बाद प्रयास करें।',
    thankYou: 'धन्यवाद। आपका अनुरोध प्राप्त हो गया है और हमारी टीम आपसे संपर्क करेगी।',
    secureFooter: '🔒 सुरक्षित • विश्वसनीय • JustTap',
    emojiTitle: 'इमोजी',
    gifTitle: 'GIF'
  }
};

const EMOJIS = [
  '😀', '😂', '😍', '👍', '🙏', '🎉',
  '❤️', '😊', '👏', '🤔', '😢', '🔥',
  '✅', '👋', '😉', '🙌', '💯', '😅'
];

const STICKERS: Array<{ emoji: string; label: string }> = [
  { emoji: '👍', label: 'Thumbs up' },
  { emoji: '🎉', label: 'Celebrate' },
  { emoji: '🙏', label: 'Thank you' },
  { emoji: '😂', label: 'Haha' },
  { emoji: '❤️', label: 'Love it' },
  { emoji: '👏', label: 'Nice work' }
];

function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
  });
}

// The "Genie is typing…" indicator stays up for at least this long,
// so it's always perceptible even when the reply comes back instantly.
const MIN_THINKING_MS = 550;

// Sessions are kept separate per language: switching the language toggle
// swaps to that language's own session id, so its message history, and
// the backend's conversation state for it, are entirely independent —
// nothing gets mixed or translated, they're just different threads.
function getSessionForLang(lang: string): string {
  const key = `justtap_session_${lang}`;
  const current = localStorage.getItem(key);

  if (current) return current;

  const next = crypto.randomUUID();
  localStorage.setItem(key, next);
  return next;
}

function resetSessionForLang(lang: string): string {
  const next = crypto.randomUUID();
  localStorage.setItem(`justtap_session_${lang}`, next);
  return next;
}

function messagesKey(sessionId: string): string {
  return `justtap_messages_${sessionId}`;
}

function getStoredMessages(sessionId: string): any[] {
  try {
    const raw = localStorage.getItem(
      messagesKey(sessionId)
    );
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredMessages(
  sessionId: string,
  messages: any[]
) {
  try {
    localStorage.setItem(
      messagesKey(sessionId),
      JSON.stringify(messages)
    );
  } catch {
    // Storage full or unavailable - conversation still works,
    // it just won't survive a full close/reopen this time.
  }
}

function clearStoredMessages(sessionId: string) {
  localStorage.removeItem(
    messagesKey(sessionId)
  );
}

function Icon({
  name,
  size = 21
}: {
  name: string;
  size?: number;
}) {
  const p: any = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round'
  };

  const x: any = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0" />
        <path d="M12 18v4M8 22h8" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    message: (
      <path d="M20 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3z" />
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="3" />
        <path d="M5 21a7 7 0 0 1 14 0" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    grid: (
      <>
        <rect x="4" y="4" width="6" height="6" />
        <rect x="14" y="4" width="6" height="6" />
        <rect x="4" y="14" width="6" height="6" />
        <rect x="14" y="14" width="6" height="6" />
      </>
    ),
    smiley: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 14s1.5 2 4 2 4-2 4-2" />
        <path d="M9 9h.01M15 9h.01" />
      </>
    ),
    gif: (
      <>
        <rect x="3" y="6" width="18" height="12" rx="3" />
        <path d="M7 10v4M7 12h1.5M12 10a2 2 0 0 0-2 2 2 2 0 0 0 2 2 2 2 0 0 0 2-2M16 10v4M16 10h2M16 12h1.5" />
      </>
    ),
    thumbUp: (
      <path d="M7 22V11m0 11h11.5a2 2 0 0 0 2-1.7l1.2-7A2 2 0 0 0 19.7 10H14l1-5.5A1.5 1.5 0 0 0 13.5 3L7 11" />
    ),
    thumbDown: (
      <path d="M17 2v11m0-11H5.5a2 2 0 0 0-2 1.7l-1.2 7A2 2 0 0 0 4.3 14H10l-1 5.5A1.5 1.5 0 0 0 10.5 21L17 13" />
    ),
    bookmark: (
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    ),
    check: (
      <path d="M20 6 9 17l-5-5" />
    )
  };

  return <svg {...p}>{x[name]}</svg>;
}

function Mascot({
  className = ''
}: {
  className?: string;
}) {
  return (
    <img
      className={`mascot ${className}`}
      src="/bot.png"
      alt="JustTap Genie"
    />
  );
}

function ChatbotPanel({
  onClose
}: {
  onClose: () => void;
}) {
  const [lang, setLang] =
    useState<Lang>(
      (localStorage.getItem(
        'justtap_language'
      ) as Lang) || 'en'
    );

  const [sessionId, setSessionId] =
    useState(() => getSessionForLang(lang));

  const [messages, setMessages] =
    useState<any[]>(() =>
      getStoredMessages(sessionId)
    );

  const [input, setInput] =
    useState('');

  const [isAtBottom, setIsAtBottom] =
    useState(true);

  const messagesRef =
    useRef<HTMLDivElement>(null);

  const bottomRef =
    useRef<HTMLDivElement>(null);

  const [notice, setNotice] =
    useState('');

  const [lead, setLead] =
    useState(false);

  const [service, setService] =
    useState('');

  const [form, setForm] =
    useState({
      name: '',
      phone: '',
      location: '',
      requirement: ''
    });

  const [isListening, setIsListening] =
    useState(false);

  const [voiceStatus, setVoiceStatus] =
    useState('');

  const recognitionRef =
    useRef<any>(null);

  // Thinking indicator: shown while waiting for a response.
  const [isThinking, setIsThinking] =
    useState(false);

  // Word-by-word reveal: id of the bot message currently streaming in.
  const [streamingId, setStreamingId] =
    useState<number | null>(null);

  const streamTimer =
    useRef<any>(null);

  const idRef =
    useRef(0);

  const nextId = () =>
    (idRef.current += 1);

  const [feedback, setFeedback] =
    useState<Record<number, 'up' | 'down'>>({});

  const [emojiOpen, setEmojiOpen] =
    useState(false);

  const [gifOpen, setGifOpen] =
    useState(false);

  const t = T[lang];

  useEffect(() => {
    localStorage.setItem(
      'justtap_language',
      lang
    );

    // Cancel any in-flight word-by-word reveal from the previous
    // thread — it targets a message id that won't exist once we've
    // switched to a different language's message list.
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }

    // Each language keeps its own separate session + message thread —
    // switching languages loads that language's own conversation.
    // The greeting itself lives only in the static welcome card above
    // the message list, so a fresh thread simply starts empty.
    const nextSessionId = getSessionForLang(lang);
    const stored = getStoredMessages(nextSessionId);

    setSessionId(nextSessionId);
    setMessages(stored);

    setInput('');
    setNotice('');
    setLead(false);
    setIsAtBottom(true);
    setIsThinking(false);
    setStreamingId(null);
    setFeedback({});
    setEmojiOpen(false);
    setGifOpen(false);
  }, [lang]);

  // Resume support: keep the conversation saved so closing and
  // reopening the widget shows the previous chat instead of a blank one.
  // Skipped mid-stream so partial (still-revealing) text never gets persisted.
  useEffect(() => {
    if (streamingId === null) {
      saveStoredMessages(sessionId, messages);
    }
  }, [sessionId, messages, streamingId]);

  // Only auto-scroll to the newest message when the user is already
  // at the bottom, so scrolling up to re-read history isn't interrupted.
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({
        behavior: 'smooth'
      });
    }
  }, [messages, isAtBottom]);

  const handleMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight -
      el.scrollTop -
      el.clientHeight;
    setIsAtBottom(distanceFromBottom < 40);
  };

  const scrollToLatest = () => {
    bottomRef.current?.scrollIntoView({
      behavior: 'smooth'
    });
    setIsAtBottom(true);
  };

  const newChat = () => {
    if (streamTimer.current) {
      clearInterval(streamTimer.current);
      streamTimer.current = null;
    }

    // Only resets the current language's thread — the other language's
    // conversation (if any) is untouched.
    clearStoredMessages(sessionId);
    const next = resetSessionForLang(lang);
    setSessionId(next);
    setMessages([]);
    setInput('');
    setNotice('');
    setLead(false);
    setIsAtBottom(true);
    setIsThinking(false);
    setStreamingId(null);
    setFeedback({});
    setEmojiOpen(false);
    setGifOpen(false);
  };

  const saveChatToFile = () => {
    const lines = messages.map(message => {
      const who =
        message.role === 'user'
          ? 'You'
          : 'Genie';
      return `[${message.time || ''}] ${who}: ${message.text}`;
    });

    const blob = new Blob(
      [lines.join('\n')],
      { type: 'text/plain' }
    );

    const url =
      URL.createObjectURL(blob);

    const a =
      document.createElement('a');

    a.href = url;
    a.download = `justtap-chat-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reveals `fullText` inside the message identified by `id` one word
  // at a time, instead of dumping the whole reply in a single paragraph.
  const streamReply = (
    id: number,
    fullText: string
  ) => {
    const words =
      fullText.split(/(\s+)/);

    let cursor = 0;

    setStreamingId(id);

    if (streamTimer.current) {
      clearInterval(streamTimer.current);
    }

    streamTimer.current =
      setInterval(() => {
        cursor += 1;

        const partial =
          words
            .slice(0, cursor)
            .join('');

        setMessages(
          current =>
            current.map(message =>
              message.id === id
                ? { ...message, text: partial }
                : message
            )
        );

        if (cursor >= words.length) {
          clearInterval(streamTimer.current);
          streamTimer.current = null;
          setStreamingId(null);
        }
      }, 45);
  };

  const ask = async (
    text = input
  ) => {
    const q = text.trim();

    if (!q) return;

    setInput('');
    setEmojiOpen(false);
    setGifOpen(false);

    // Sending a message means the customer wants to see it (and the
    // reply that follows) right away — jump to the latest message even
    // if they'd scrolled up into history, instead of leaving the send
    // "stuck" out of view below the fold.
    setIsAtBottom(true);

    setMessages(
      current => [
        ...current,
        {
          id: nextId(),
          role: 'user',
          text: q,
          time: nowTime()
        }
      ]
    );

    setIsThinking(true);

    const askStartedAt = Date.now();

    // The bouncing-dot "thinking" indicator should always be visible
    // for at least a moment — otherwise a very fast (or instantly
    // failing) request makes it flash past unnoticed.
    const waitForMinThinkTime = async () => {
      const elapsed = Date.now() - askStartedAt;
      const remaining = MIN_THINKING_MS - elapsed;
      if (remaining > 0) {
        await new Promise(resolve =>
          setTimeout(resolve, remaining)
        );
      }
    };

    try {
      const response =
        await fetch(
          `${API}/api/v1/chat`,
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
              Accept:
                'application/json'
            },
            body: JSON.stringify({
              sessionId,
              message: q,
              language: lang,
              audience: 'customer'
            })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
          'Chat request failed'
        );
      }

      await waitForMinThinkTime();
      setIsThinking(false);

      const botId = nextId();
      const answer =
        data.answer ||
        'No response available.';

      setMessages(
        current => [
          ...current,
          {
            id: botId,
            role: 'bot',
            text: '',
            time: nowTime()
          }
        ]
      );

      streamReply(botId, answer);

      setNotice(
        data.ticketCreated || data.type === 'ticket_confirmation'
          ? 'ticket'
          : ''
      );

      if (data.type === 'lead_offer') {
        setService(
          data.service || ''
        );
        setLead(true);
      }

    } catch (error) {
      console.error(error);

      await waitForMinThinkTime();
      setIsThinking(false);

      const errorId = nextId();

      setMessages(
        current => [
          ...current,
          {
            id: errorId,
            role: 'bot',
            text: '',
            time: nowTime()
          }
        ]
      );

      streamReply(errorId, t.connectError);
    }
  };

  const confirm = async (
    yes: boolean
  ) => {
    setNotice('');

    await ask(
      yes ? 'yes' : 'no'
    );
  };

  const voice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setVoiceStatus(t.notSupported);
      return;
    }

    const recognition =
      new SpeechRecognition();

    recognitionRef.current =
      recognition;

    recognition.lang =
      lang === 'hi'
        ? 'hi-IN'
        : 'en-IN';

    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setVoiceStatus(t.listening);
    };

    recognition.onresult =
      (event: any) => {
        let transcript = '';

        for (
          let i =
            event.resultIndex || 0;
          i < event.results.length;
          i++
        ) {
          transcript +=
            event.results[i][0]
              .transcript;
        }

        if (transcript.trim()) {
          setInput(
            transcript.trim()
          );
        }
      };

    recognition.onerror =
      (event: any) => {
        setIsListening(false);
        recognitionRef.current =
          null;

        setVoiceStatus(
          event?.error === 'no-speech'
            ? t.noSpeech
            : t.voiceFailed
        );
      };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current =
        null;
      setVoiceStatus('');
    };

    recognition.start();
  };

  const lastBotIndex = (() => {
    for (
      let i = messages.length - 1;
      i >= 0;
      i--
    ) {
      if (messages[i].role === 'bot') return i;
    }
    return -1;
  })();

  const showHelpful =
    lastBotIndex > 0 &&
    streamingId === null &&
    !isThinking;

  return (
    <div className="customer-panel">
      <header className="genie-header">
        <div className="header-decor" aria-hidden="true">
          <svg viewBox="0 0 400 140" preserveAspectRatio="none">
            <path d="M0 140V90h18V70h16v20h14V55h20v55h16V60h22v50h18V40h24v70h20V75h18v35h16V45h26v65h20V80h16v30h20V50h22v60h20V80h20V140Z" />
          </svg>
          <span className="sparkle s1">✦</span>
          <span className="sparkle s2">✦</span>
          <span className="sparkle s3">✦</span>
          <span className="sparkle s4">✦</span>
        </div>

        <button
          type="button"
          className="chat-close"
          aria-label="Close Genie"
          title="Cancel"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>

        <div className="genie-brand">
          <Mascot />

          <div className="genie-brand-copy">
            <strong>
              Genie
              <span className="verified" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            </strong>

            <span className="assistant-tag">
              {t.assistantTag}
            </span>
          </div>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="new-chat-link"
            onClick={newChat}
          >
            <Icon name="plus" size={14} />
            {t.newChat}
          </button>

          <button
            type="button"
            className="save-chat"
            onClick={saveChatToFile}
          >
            <Icon name="bookmark" size={14} />
            {t.saveChat}
          </button>
        </div>

        <div className="language-bar">
          {(
            Object.keys(
              LANGS
            ) as Lang[]
          ).map((language, i) => (
            <React.Fragment key={language}>
              {i > 0 && (
                <span
                  className="lang-sep"
                  aria-hidden="true"
                >
                  |
                </span>
              )}

              <button
                type="button"
                className={
                  lang === language
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setLang(language)
                }
              >
                <span className="lang-flag">
                  {LANGS[language].flag}
                </span>
                {LANGS[language].label}
              </button>
            </React.Fragment>
          ))}
        </div>
      </header>

      <main className="chat-area">
        <div className="welcome-card">
          <Mascot className="welcome-mascot" />

          <div>
            <h1>
              {t.welcome}
            </h1>
            <p>
              {t.subtitle}
            </p>
          </div>
        </div>

        <div
          className="messages"
          ref={messagesRef}
          onScroll={handleMessagesScroll}
        >
          {messages.map(
            (message, index) => (
              <div
                key={`${message.id ?? "message"}-${index}`}
                className={
                  `message-row ${message.role}`
                }
              >
                {message.role === 'bot' && (
                  <img
                    className="bubble-avatar"
                    src="/bot.png"
                    alt=""
                  />
                )}

                <div className="bubble-stack">
                  <div
                    className={
                      `bubble ${message.role}`
                    }
                  >
                    {message.text}
                    {message.id === streamingId && (
                      <span className="stream-caret" />
                    )}
                  </div>

                  {message.time && (
                    <div
                      className={
                        `bubble-meta ${message.role}`
                      }
                    >
                      {message.time}
                      {message.role === 'user' && (
                        <Icon name="check" size={12} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )}

          {isThinking && (
            <div className="message-row bot">
              <img
                className="bubble-avatar"
                src="/bot.png"
                alt=""
              />

              <div className="bubble bot thinking-bubble" aria-label={t.thinking}>
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          )}

          {notice === 'ticket' && (
            <div className="ticket-confirm">
              <p>{t.ticket}</p>

              <button
                type="button"
                onClick={() =>
                  void confirm(true)
                }
              >
                {t.yes}
              </button>

              <button
                type="button"
                onClick={() =>
                  void confirm(false)
                }
              >
                {t.no}
              </button>
            </div>
          )}

          {showHelpful && (
            <div className="helpful-row">
              <span>{t.helpful}</span>

              <button
                type="button"
                className={
                  feedback[lastBotIndex] === 'up'
                    ? 'active'
                    : ''
                }
                aria-label="Helpful"
                onClick={() =>
                  setFeedback(current => ({
                    ...current,
                    [lastBotIndex]: 'up'
                  }))
                }
              >
                <Icon name="thumbUp" size={16} />
              </button>

              <button
                type="button"
                className={
                  feedback[lastBotIndex] === 'down'
                    ? 'active'
                    : ''
                }
                aria-label="Not helpful"
                onClick={() =>
                  setFeedback(current => ({
                    ...current,
                    [lastBotIndex]: 'down'
                  }))
                }
              >
                <Icon name="thumbDown" size={16} />
              </button>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {!isAtBottom && (
          <button
            type="button"
            className="scroll-latest"
            onClick={scrollToLatest}
          >
            <Icon name="clock" size={14} />
            {t.backToLatest}
          </button>
        )}
      </main>

      <div className="composer-wrap">
        {voiceStatus && (
          <div
            className="voice-status"
            role="status"
          >
            {voiceStatus}
          </div>
        )}

        {emojiOpen && (
          <div className="picker-panel emoji-panel">
            {EMOJIS.map(emoji => (
              <button
                type="button"
                key={emoji}
                onClick={() => {
                  setInput(
                    current => current + emoji
                  );
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        {gifOpen && (
          <div className="picker-panel gif-panel">
            {STICKERS.map(sticker => (
              <button
                type="button"
                key={sticker.emoji}
                onClick={() => {
                  setGifOpen(false);
                  void ask(sticker.emoji);
                }}
              >
                <span className="sticker-emoji">
                  {sticker.emoji}
                </span>
                <small>{sticker.label}</small>
              </button>
            ))}
          </div>
        )}

        <div className="composer">
          <input
            value={input}
            onChange={event =>
              setInput(
                event.target.value
              )
            }
            onFocus={() => {
              setEmojiOpen(false);
              setGifOpen(false);
            }}
            onKeyDown={event => {
              if (
                event.key === 'Enter'
              ) {
                void ask();
              }
            }}
            placeholder={t.type}
          />

          <button
            type="button"
            className={
              `mic ${
                isListening
                  ? 'listening'
                  : ''
              }`
            }
            onClick={voice}
            aria-label={
              isListening
                ? 'Stop listening'
                : 'Start voice input'
            }
          >
            <Icon name="mic" size={18} />
          </button>

          <button
            type="button"
            className="send"
            onClick={() => void ask()}
            aria-label={t.send}
          >
            <Icon name="send" size={18} />
          </button>
        </div>

        <div className="composer-tools">
          <button
            type="button"
            className={
              `icon-btn ${emojiOpen ? 'active' : ''}`
            }
            title={t.emojiTitle}
            aria-label={t.emojiTitle}
            onClick={() => {
              setGifOpen(false);
              setEmojiOpen(open => !open);
            }}
          >
            <Icon name="smiley" size={14} />
            <span>{t.emojiTitle}</span>
          </button>

          <button
            type="button"
            className={
              `icon-btn ${gifOpen ? 'active' : ''}`
            }
            title={t.gifTitle}
            aria-label={t.gifTitle}
            onClick={() => {
              setEmojiOpen(false);
              setGifOpen(open => !open);
            }}
          >
            <Icon name="gif" size={14} />
            <span>{t.gifTitle}</span>
          </button>
        </div>

        <div className="secure-footer">
          {t.secureFooter}
        </div>
      </div>

      {lead && (
        <LeadModal
          t={t}
          service={service}
          form={form}
          setForm={setForm}
          close={() =>
            setLead(false)
          }
          submit={async (
            event: any
          ) => {
            event.preventDefault();

            const response =
              await fetch(
                `${API}/api/support/leads`,
                {
                  method: 'POST',
                  headers: {
                    'Content-Type':
                      'application/json'
                  },
                  body:
                    JSON.stringify({
                      sessionId,
                      ...form,
                      service
                    })
                }
              );

            if (response.ok) {
              setLead(false);

              setMessages(
                current => [
                  ...current,
                  {
                    id: nextId(),
                    role: 'bot',
                    text: t.thankYou,
                    time: nowTime()
                  }
                ]
              );
            }
          }}
        />
      )}
    </div>
  );
}

function LeadModal({
  t,
  service,
  form,
  setForm,
  close,
  submit
}: any) {
  return (
    <div className="modal">
      <form onSubmit={submit}>
        <button
          type="button"
          className="modal-x"
          onClick={close}
        >
          <Icon name="close" />
        </button>

        <h2>{t.contact}</h2>

        <p>
          Service:{' '}
          <b>
            {service ||
              'requested service'}
          </b>
        </p>

        <input
          required
          placeholder={t.name}
          value={form.name}
          onChange={event =>
            setForm({
              ...form,
              name:
                event.target.value
            })
          }
        />

        <input
          required
          placeholder={t.phone}
          value={form.phone}
          onChange={event =>
            setForm({
              ...form,
              phone:
                event.target.value
            })
          }
        />

        <input
          placeholder={t.location}
          value={form.location}
          onChange={event =>
            setForm({
              ...form,
              location:
                event.target.value
            })
          }
        />

        <textarea
          placeholder={
            t.requirement
          }
          value={
            form.requirement
          }
          onChange={event =>
            setForm({
              ...form,
              requirement:
                event.target.value
            })
          }
        />

        <button
          className="submit"
          type="submit"
        >
          {t.submit}
        </button>
      </form>
    </div>
  );
}

// Provider dashboard is preserved from the working project.
type SupportTicket = {
  id: string;
  sessionId: string;
  audience: string;
  question: string;
  status: string;
  createdAt: string;
  messages?: Array<{
    id: string;
    role: string;
    text: string;
    createdAt: string;
  }>;
};

function SupportProviderApp() {
  const [
    section,
    setSection
  ] = useState('Tickets');

  const sections = [
    ['Tickets', 'message'],
    ['My Tickets', 'user'],
    ['Unassigned', 'clock'],
    ['Customers', 'user'],
    ['Settings', 'grid']
  ];

  return (
    <div className="provider-app">
      <aside className="provider-sidebar">
        <div className="provider-brand">
          <Mascot />
          <span>Genie</span>
        </div>

        <div className="provider-label">
          CUSTOMER SUPPORT
        </div>

        {sections.map(
          ([name, icon]) => (
            <button
              type="button"
              key={name}
              className={
                section === name
                  ? 'active'
                  : ''
              }
              onClick={() =>
                setSection(name)
              }
            >
              <Icon name={icon} />
              {name}
            </button>
          )
        )}

        <a
          className="back-customer"
          href="/"
        >
          <span>‹</span>
          Customer Chat
        </a>
      </aside>

      <main className="provider-main">
        <header className="provider-top">
          <div>
            <span className="eyebrow">
              PROVIDER DASHBOARD
            </span>
            <h1>{section}</h1>
          </div>

          <div className="provider-user">
            <span className="support-status">
              Customer Support
            </span>
            <Mascot className="provider-avatar" />
          </div>
        </header>

        {section === 'Tickets' && (
          <SupportTickets />
        )}

        {section === 'My Tickets' && (
          <SupportTickets filter="mine" />
        )}

        {section === 'Unassigned' && (
          <SupportTickets filter="unassigned" />
        )}

        {section === 'Customers' && (
          <SupportCustomers />
        )}

        {section === 'Settings' && (
          <SupportSettings />
        )}
      </main>
    </div>
  );
}

function useSupportApi() {
  const [
    tickets,
    setTickets
  ] = useState<SupportTicket[]>([]);

  const [error, setError] =
    useState('');

  const [loading, setLoading] =
    useState(false);

  const token =
    localStorage.getItem(
      'justtap_admin_token'
    ) || '';

  const request = async (
    url: string,
    options: RequestInit = {}
  ) => {
    const response =
      await fetch(
        `${API}${url}`,
        {
          ...options,
          headers: {
            Accept:
              'application/json',
            'Content-Type':
              'application/json',
            Authorization:
              `Bearer ${token}`,
            ...(options.headers || {})
          }
        }
      );

    const raw =
      await response.text();

    let data: any = null;

    try {
      data = raw
        ? JSON.parse(raw)
        : null;
    } catch {
      throw new Error(
        `Invalid server response (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.error ||
        `Request failed (${response.status})`
      );
    }

    return data;
  };

  const load = async () => {
    setLoading(true);
    setError('');

    try {
      const data =
        await request(
          '/api/support/tickets'
        );

      const rows = Array.isArray(data)
        ? data
        : Array.isArray(data?.tickets)
          ? data.tickets
          : [];

      setTickets(rows.map((ticket: any) => ({
        id: ticket.id ?? ticket.ticketId,
        sessionId:
          ticket.sessionId ??
          ticket.conversationId ??
          '',
        audience:
          ticket.audience ??
          ticket.category ??
          'support',
        question:
          ticket.question ??
          ticket.subject ??
          ticket.description ??
          'Support request',
        status:
          ticket.status === 'open'
            ? 'unassigned'
            : ticket.status ?? 'unassigned',
        createdAt:
          ticket.createdAt ??
          new Date().toISOString(),
        messages:
          Array.isArray(ticket.messages)
            ? ticket.messages
            : []
      })));
    } catch (error: any) {
      setError(
        error?.message ||
        'Unable to load tickets.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const claim = async (
    id: string
  ) => {
    await request(
      `/api/support/tickets/${encodeURIComponent(id)}/claim`,
      { method: 'POST' }
    );
    await load();
  };

  const resolve = async (
    id: string
  ) => {
    await request(
      `/api/support/tickets/${encodeURIComponent(id)}/resolve`,
      { method: 'PATCH' }
    );
    await load();
  };

  const reply = async (
    id: string,
    text: string
  ) => {
    await request(
      `/api/support/tickets/${encodeURIComponent(id)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify({ text })
      }
    );
    await load();
  };

  return {
    tickets,
    error,
    loading,
    load,
    claim,
    resolve,
    reply
  };
}

function TicketRow({
  ticket,
  onOpen,
  onClaim,
  onResolve
}: {
  ticket: SupportTicket;
  onOpen: () => void;
  onClaim?: () => void;
  onResolve?: () => void;
}) {
  return (
    <div className="support-ticket-row">
      <div className="support-ticket-main">
        <div className="support-ticket-id">
          {ticket.id}
        </div>

        <strong>
          {ticket.question}
        </strong>

        <small>
          {new Date(
            ticket.createdAt
          ).toLocaleString()}
        </small>
      </div>

      <span
        className={
          `ticket-status ${ticket.status}`
        }
      >
        {ticket.status.replace(
          '_',
          ' '
        )}
      </span>

      <div className="ticket-actions">
        <button
          type="button"
          onClick={onOpen}
        >
          Open
        </button>

        {ticket.status ===
          'unassigned' &&
          onClaim && (
            <button
              type="button"
              onClick={onClaim}
            >
              Claim
            </button>
          )}

        {ticket.status !==
          'resolved' &&
          onResolve && (
            <button
              type="button"
              onClick={onResolve}
            >
              Resolve
            </button>
          )}
      </div>
    </div>
  );
}

function SupportTickets({
  filter
}: {
  filter?: 'mine' | 'unassigned';
} = {}) {
  const {
    tickets,
    error,
    loading,
    load,
    claim,
    resolve,
    reply
  } = useSupportApi();

  const [
    selected,
    setSelected
  ] = useState<SupportTicket | null>(
    null
  );

  const [
    text,
    setText
  ] = useState('');

  const visible =
    tickets.filter(ticket =>
      filter === 'mine'
        ? ticket.status ===
          'in_progress'
        : filter === 'unassigned'
          ? ticket.status ===
            'unassigned'
          : true
    );

  const send = async () => {
    if (
      !selected ||
      !text.trim()
    ) return;

    await reply(
      selected.id,
      text.trim()
    );

    setText('');
    setSelected(null);
  };

  return (
    <div className="provider-content support-content">
      <div className="support-toolbar">
        <div>
          <p>
            Customer support
          </p>
          <h2>
            {filter === 'mine'
              ? 'My Tickets'
              : filter ===
                  'unassigned'
                ? 'Unassigned'
                : 'Resolve customer issues'}
          </h2>
        </div>

        <button
          className="support-refresh"
          type="button"
          onClick={() =>
            void load()
          }
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="support-error">
          {error}
          <small>
            Set ADMIN_TOKEN and save
            it in Provider → Settings.
          </small>
        </div>
      )}

      {loading && (
        <div className="provider-card">
          Loading tickets...
        </div>
      )}

      {!loading &&
        !visible.length && (
          <div className="provider-card empty-provider">
            <Icon
              name="message"
              size={42}
            />
            <h2>No tickets</h2>
            <p>
              Customer support tickets
              will appear here.
            </p>
          </div>
        )}

      <div className="support-ticket-list">
        {visible.map(ticket => (
          <TicketRow
            key={ticket.id}
            ticket={ticket}
            onOpen={() =>
              setSelected(ticket)
            }
            onClaim={() =>
              void claim(ticket.id)
            }
            onResolve={() =>
              void resolve(ticket.id)
            }
          />
        ))}
      </div>

      {selected && (
        <div className="ticket-detail-panel">
          <div className="ticket-detail-head">
            <div>
              <span>
                {selected.id}
              </span>
              <h3>
                {selected.question}
              </h3>
            </div>

            <button
              type="button"
              onClick={() =>
                setSelected(null)
              }
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="ticket-thread">
            {(selected.messages ||
              []).map((message, index) => (
                <div
                  key={`${message.id ?? "message"}-${index}`}
                  className={
                    `ticket-message ${message.role}`
                  }
                >
                  <small>
                    {message.role}
                  </small>
                  <p>
                    {message.text}
                  </p>
                </div>
              ))}
          </div>

          {selected.status !==
            'resolved' && (
            <div className="ticket-reply">
              <textarea
                value={text}
                onChange={event =>
                  setText(
                    event.target.value
                  )
                }
                placeholder="Reply to customer..."
              />

              <button
                type="button"
                onClick={() =>
                  void send()
                }
              >
                Send Reply
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SupportCustomers() {
  const [
    customers,
    setCustomers
  ] = useState<any[]>([]);

  const [error, setError] =
    useState('');

  const [loading, setLoading] =
    useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const token =
          localStorage.getItem(
            'justtap_admin_token'
          ) || '';

        const response =
          await fetch(
            `${API}/api/support/customers`,
            {
              headers: {
                Authorization:
                  `Bearer ${token}`,
                Accept:
                  'application/json'
              }
            }
          );

        const data =
          await response.json();

        if (!response.ok) {
          throw new Error(
            data?.error ||
            'Unable to load customers'
          );
        }

        setCustomers(
          Array.isArray(data)
            ? data
            : []
        );
      } catch (error: any) {
        setError(
          error?.message ||
          'Unable to load customers'
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="provider-content support-content">
      <div className="support-toolbar">
        <div>
          <p>
            Customer records
          </p>
          <h2>
            Customers
          </h2>
        </div>
      </div>

      {error && (
        <div className="support-error">
          {error}
        </div>
      )}

      {loading && (
        <div className="provider-card">
          Loading customers...
        </div>
      )}

      {!loading &&
        !customers.length &&
        !error && (
          <div className="provider-card empty-provider">
            <Icon
              name="user"
              size={42}
            />
            <h2>
              No customers with
              tickets
            </h2>
          </div>
        )}

      <div className="customer-list">
        {customers.map(customer => (
          <div
            className="customer-row"
            key={customer.sessionId}
          >
            <Icon name="user" />

            <div>
              <b>
                {customer.sessionId}
              </b>

              <small>
                {customer.tickets}{' '}
                ticket(s) · Last activity{' '}
                {new Date(
                  customer.lastActivity
                ).toLocaleString()}
              </small>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SupportSettings() {
  const [
    token,
    setToken
  ] = useState(
    localStorage.getItem(
      'justtap_admin_token'
    ) || ''
  );

  return (
    <div className="provider-content support-content">
      <section className="provider-card">
        <h2>
          Support Settings
        </h2>

        <p className="muted">
          Configure the provider/admin
          API token.
        </p>

        <label className="settings-field">
          <span>
            Admin Token
          </span>

          <input
            type="password"
            value={token}
            onChange={event =>
              setToken(
                event.target.value
              )
            }
            placeholder="ADMIN_TOKEN"
          />
        </label>

        <button
          className="submit"
          type="button"
          onClick={() => {
            if (token.trim()) {
              localStorage.setItem(
                'justtap_admin_token',
                token.trim()
              );
            } else {
              localStorage.removeItem(
                'justtap_admin_token'
              );
            }
          }}
        >
          Save Settings
        </button>
      </section>
    </div>
  );
}

function CustomerHost() {
  const [
    open,
    setOpen
  ] = useState(false);

  return (
    <div className="app-host">
      {!open && (
        <button
          className="genie-launcher"
          aria-label="Open Genie chatbot"
          onClick={() =>
            setOpen(true)
          }
        >
          <img
            src="/genie-launcher.png"
            alt="Open Genie"
          />
          <span
            className="launcher-pulse"
            aria-hidden="true"
          />
        </button>
      )}

      {open && (
        <ChatbotPanel
          onClose={() =>
            setOpen(false)
          }
        />
      )}
    </div>
  );
}

function App() {
  return location.pathname.startsWith(
    '/provider'
  ) ? (
    <SupportProviderApp />
  ) : (
    <CustomerHost />
  );
}

createRoot(
  document.getElementById('root')!
).render(<App />);
