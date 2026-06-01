# Architecture Overview

## System Design

The platform is a Turborepo monorepo split into 4 apps and 8 packages.

## Data Flow

### Inbound Call Flow
1. Customer calls Twilio number
2. Twilio POSTs to `voice-agent /voice/incoming`
3. `VoiceService.handleIncoming()` creates/finds a Lead in PostgreSQL
4. In-memory session created for the call
5. Greeting generated via ElevenLabs TTS, served as audio URL
6. TwiML `<Gather>` returned — Twilio plays audio and waits for speech
7. Customer speaks → Twilio POSTs speech text to `/voice/gather`
8. `VoiceService.handleSpeech()` processes the utterance:
   - Adds message to session history
   - Stores in `Conversation` table
   - Sends full history to Claude via Bedrock
   - Extracts `LeadData` JSON from transcript
   - Recalculates lead score
   - Updates `Lead` in DB
   - Generates TTS response
9. Loop continues until hangup
10. `handleCallComplete()` summarizes conversation, updates `CallLog`

### Lead Scoring Engine
Scoring is deterministic — 20 points each for: budget, location, propertyType, timeline, siteVisitBooked.

### Property Matching
Weighted scoring: city (30pts), area (25pts), propertyType (20pts), BHK (15pts), budget (10pts).

### Background Workers (BullMQ)
- **lead-scoring**: Rescores leads on demand
- **follow-up**: Triggers outbound calls for stale leads (score <80, inactive 2+ days)
- **recommendation**: Finds best property matches and saves to lead notes

## Security Model
- JWT authentication on all API routes (7-day tokens)
- Helmet.js security headers
- Rate limiting: 200 requests per 15 minutes per IP
- Zod validation on all inputs
- bcrypt password hashing (cost factor 12)
- Environment variables validated at startup via Zod

## Database Schema
PostgreSQL via Prisma ORM. Key relationships:
- Lead → Conversations (1:N)
- Lead → SiteVisits (1:N)  
- Lead → CallLogs (1:N)
- Property → SiteVisits (1:N)
