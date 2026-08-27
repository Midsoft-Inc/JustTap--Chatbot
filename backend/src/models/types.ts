export type KnowledgeRecord = {
  id: string;
  language: string;
  category: string;
  sub_service?: string | null;
  intent: string;
  audience?: string;
  location?: string | null;
  question: string;
  answer: string;
  keywords: string[];
  source?: string;
  metadata?: Record<string, unknown>;
  embedding?: number[];
};

export type SearchHit = KnowledgeRecord & { score: number; sourceType: 'vector' | 'keyword' };

export type ChatRequest = {
  message: string;
  sessionId?: string;
  customerReference?: string;
};

export type Ticket = {
  ticketId: string;
  conversationId: string;
  customerReference?: string;
  category: string;
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'assigned' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
  slaHours: number;
  assignedTo?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
