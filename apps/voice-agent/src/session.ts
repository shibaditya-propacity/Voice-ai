import type { ConversationMessage } from '@property-ai/ai';
import type { LeadData, Language } from '@property-ai/shared';

export interface CallSession {
  callSid: string;
  leadId?: string;
  messages: ConversationMessage[];
  leadData: Partial<LeadData>;
  language: Language;
  createdAt: Date;
  lastActivity: Date;
}

const sessions = new Map<string, CallSession>();

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export function createSession(callSid: string, phone?: string): CallSession {
  const session: CallSession = {
    callSid,
    messages: [],
    leadData: phone ? { phone } : {},
    language: 'en',
    createdAt: new Date(),
    lastActivity: new Date(),
  };
  sessions.set(callSid, session);
  return session;
}

export function getSession(callSid: string): CallSession | undefined {
  const session = sessions.get(callSid);
  if (session) session.lastActivity = new Date();
  return session;
}

export function updateSession(callSid: string, updates: Partial<CallSession>): void {
  const session = sessions.get(callSid);
  if (session) {
    Object.assign(session, updates, { lastActivity: new Date() });
  }
}

export function deleteSession(callSid: string): void {
  sessions.delete(callSid);
}

// Cleanup expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sid, session] of sessions.entries()) {
    if (now - session.lastActivity.getTime() > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
}, 10 * 60 * 1000);
