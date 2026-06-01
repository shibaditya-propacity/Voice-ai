import { BedrockClaudeProvider } from '@property-ai/ai';
import {
  generateAndCacheSpeech,
} from '@property-ai/elevenlabs';
import {
  generateGatherTwiML,
  generateHangupTwiML,
} from '@property-ai/twilio';
import { prisma } from '@property-ai/database';
import { createChildLogger } from '@property-ai/logger';
import { calculateLeadScore, mergeLeadData } from '@property-ai/lead-engine';
import type { Language } from '@property-ai/shared';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
} from './session.js';
import { uploadAudio, getAudioPublicUrl } from './audio-store.js';

const log = createChildLogger({ module: 'voice-service' });

// Sonnet via Bedrock — verified working model
const aiProvider = new BedrockClaudeProvider(
  process.env.AWS_REGION ?? 'us-east-1',
  'us.anthropic.claude-sonnet-4-6'
);

const VOICE_AGENT_URL = process.env.VOICE_AGENT_URL ?? 'http://localhost:4001';
const GATHER_URL = `${VOICE_AGENT_URL}/voice/gather`;

export class VoiceService {
  async handleIncoming(callSid: string, from: string): Promise<string> {
    const session = createSession(callSid, from);

    // Find or create lead
    let lead = await prisma.lead.findUnique({ where: { phone: from } });
    if (!lead) {
      lead = await prisma.lead.create({ data: { phone: from } });
    }
    updateSession(callSid, { leadId: lead.id, leadData: { phone: from } });

    // Generate greeting
    const greeting = this.getGreeting(session.language);
    return this.buildTwiMLResponse(greeting, session.language, callSid);
  }

  async handleOutbound(callSid: string, to: string): Promise<string> {
    const session = createSession(callSid, to);
    let lead = await prisma.lead.findUnique({ where: { phone: to } });
    if (!lead) {
      lead = await prisma.lead.create({ data: { phone: to } });
    }
    updateSession(callSid, { leadId: lead.id, leadData: { phone: to } });

    const greeting = this.getGreeting('en');
    return this.buildTwiMLResponse(greeting, 'en', callSid);
  }

  async handleSpeech(callSid: string, speechText: string, from?: string): Promise<string> {
    let session = getSession(callSid);
    if (!session) {
      // Session lost (e.g. server restart) — recover gracefully
      log.warn({ callSid }, 'Session not found, recovering');
      session = createSession(callSid, from);
      let lead = from ? await prisma.lead.findUnique({ where: { phone: from } }) : null;
      if (!lead && from) lead = await prisma.lead.create({ data: { phone: from } });
      if (lead) updateSession(callSid, { leadId: lead.id, leadData: { phone: from } });
    }

    if (!speechText.trim()) {
      return this.buildTwiMLResponse(
        'I did not catch that. Could you please repeat?',
        session.language,
        callSid
      );
    }

    // Add user message
    const updatedMessages = [
      ...session.messages,
      { role: 'user' as const, content: speechText },
    ];

    // Run AI response + language detection in parallel with user message DB write
    const [{ text: aiText, language: detectedLang }] = await Promise.all([
      aiProvider.generateResponse(updatedMessages, '', session.language),
      session.leadId
        ? prisma.conversation.create({
            data: { leadId: session.leadId, role: 'USER', content: speechText, language: session.language },
          })
        : Promise.resolve(),
    ]);

    const allMessages = [...updatedMessages, { role: 'assistant' as const, content: aiText }];
    updateSession(callSid, { messages: allMessages, language: detectedLang });

    // Build TwiML response immediately — don't wait for DB/lead extraction
    const twiml = await this.buildTwiMLResponse(aiText, detectedLang, callSid);

    // Fire-and-forget: save AI response + extract lead data after responding
    if (session.leadId) {
      const leadId = session.leadId;
      setImmediate(async () => {
        try {
          await prisma.conversation.create({
            data: { leadId, role: 'ASSISTANT', content: aiText, language: detectedLang },
          });
          const transcript = allMessages
            .map((m) => `${m.role === 'user' ? 'Customer' : 'Raj'}: ${m.content}`)
            .join('\n');
          const extracted = await aiProvider.extractLeadData(transcript, session.leadData);
          const merged = mergeLeadData(session.leadData, extracted);
          updateSession(callSid, { leadData: merged });
          const score = calculateLeadScore(merged).total;
          await prisma.lead.update({ where: { id: leadId }, data: { ...merged, leadScore: score } });
        } catch (err) {
          log.error({ err }, 'Background lead update failed');
        }
      });
    }

    return twiml;
  }

  async handleCallComplete(callSid: string, status: string, duration: number): Promise<void> {
    const session = getSession(callSid);
    if (!session) return;

    if (session.leadId && session.messages.length > 0) {
      const summary = await aiProvider.summarizeConversation(session.messages);
      await prisma.callLog.updateMany({
        where: { callSid },
        data: { duration, summary, language: session.language },
      });
      log.info({ callSid, status, duration, leadId: session.leadId }, 'Call completed');
    }

    deleteSession(callSid);
  }

  private async buildTwiMLResponse(
    text: string,
    language: Language,
    callSid: string
  ): Promise<string> {
    try {
      const { buffer } = await generateAndCacheSpeech({ text });
      const audioKey = `${callSid}-${Date.now()}.mp3`;
      await uploadAudio(audioKey, buffer);
      const audioUrl = getAudioPublicUrl(audioKey);
      return generateGatherTwiML({ audioUrl, webhookUrl: GATHER_URL, language });
    } catch (err) {
      log.warn({ err }, 'ElevenLabs failed, falling back to Twilio TTS');
      return generateGatherTwiML({ text, webhookUrl: GATHER_URL, language });
    }
  }

  private getGreeting(language: Language): string {
    const greetings: Record<Language, string> = {
      en: 'Hello! This is Raj Mehta from Premium Properties. How can I help you today?',
      hi: 'नमस्ते! मैं राज मेहता हूं, प्रीमियम प्रॉपर्टीज से। आज मैं आपकी कैसे सहायता कर सकता हूं?',
      mr: 'नमस्कार! मी राज मेहता आहे, प्रीमियम प्रॉपर्टीजमधून. आज मी तुम्हाला कशी मदत करू शकतो?',
    };
    return greetings[language];
  }
}
