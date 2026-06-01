# Property AI Platform

A production-ready AI Property Consultant platform that handles inbound/outbound calls, qualifies leads automatically, and operates as an experienced property dealer in English, Hindi, and Marathi.

## Architecture

```
property-ai-platform/
├── apps/
│   ├── web/          # React CRM Dashboard (Vite + TailwindCSS)
│   ├── backend/      # Express REST API
│   ├── voice-agent/  # Twilio webhook handler + AI voice pipeline
│   └── worker/       # BullMQ background jobs
├── packages/
│   ├── ai/           # Bedrock Claude provider
│   ├── database/     # Prisma schema + client
│   ├── property-engine/ # Property matching
│   ├── lead-engine/  # Lead scoring & qualification
│   ├── twilio/       # Twilio TwiML helpers
│   ├── elevenlabs/   # Text-to-speech
│   ├── shared/       # Shared TypeScript types
│   ├── logger/       # Pino logger
│   └── config/       # Zod env validation
├── infra/docker/     # Dockerfiles + nginx config
├── docker-compose.yml
└── docker-compose.dev.yml
```

## Prerequisites

- Node.js >= 20
- pnpm >= 9
- Docker + Docker Compose
- PostgreSQL (or use Docker)
- Redis (or use Docker)

## Quick Start (Local Development)

### 1. Clone and install

```bash
git clone <repo>
cd property-ai-platform
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 3. Start infrastructure

```bash
docker-compose -f docker-compose.dev.yml up -d
```

### 4. Run database migrations and seed

```bash
pnpm db:generate
pnpm db:migrate
pnpm --filter @property-ai/database prisma db seed
```

### 5. Start all services

```bash
pnpm dev
```

Services start at:
- Web: http://localhost:3000
- Backend API: http://localhost:4000
- Voice Agent: http://localhost:4001

### Default credentials (after seeding)

- Admin: `admin@propertyai.com` / `admin123`
- Manager: `manager@propertyai.com` / `manager123`

## Production Deployment

### Docker Compose (recommended)

```bash
# Build and start all services
docker-compose up -d --build

# Run migrations
docker-compose exec backend npx prisma migrate deploy
```

### Environment Variables

See `.env.example` for all required variables.

**Critical variables:**
- `JWT_SECRET` — minimum 32 characters, random string
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` — for Bedrock Claude
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER`
- `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID`
- `VOICE_AGENT_URL` — publicly accessible URL for Twilio webhooks (use ngrok in dev)

## Twilio Setup

1. Create a Twilio account and buy a phone number
2. Set the webhook URL to `https://your-domain.com/voice/incoming`
3. For local dev, use ngrok: `ngrok http 4001`
4. Set `VOICE_AGENT_URL=https://your-ngrok-url.ngrok.io`

## AI Voice Flow

```
Customer calls Twilio number
        ↓
Twilio webhooks voice-agent (/voice/incoming)
        ↓
Session created, lead upserted in DB
        ↓
Greeting generated → ElevenLabs TTS → Audio URL
        ↓
TwiML with <Gather> returned to Twilio
        ↓
Customer speaks → Twilio sends to /voice/gather
        ↓
Speech text → Claude (Bedrock) → AI response
        ↓
Lead data extracted and updated in DB
        ↓
Response → ElevenLabs TTS → TwiML
        ↓
Loop until hangup
        ↓
Conversation summarized, CallLog updated
```

## Lead Scoring

| Factor | Points |
|--------|--------|
| Budget provided | 20 |
| Location provided | 20 |
| Property type | 20 |
| Timeline provided | 20 |
| Site visit booked | 20 |
| **Maximum** | **100** |

- **HOT** (80-100): Immediate follow-up
- **WARM** (40-79): Schedule follow-up
- **COLD** (0-39): Nurture sequence

## API Reference

### Auth
- `POST /api/auth/login` — Login with email/password
- `GET /api/auth/me` — Get current user

### Leads
- `GET /api/leads` — List leads (supports `?search=`, `?page=`, `?limit=`, `?city=`, `?propertyType=`)
- `GET /api/leads/:id` — Get lead with conversations, visits, call logs
- `POST /api/leads` — Create lead
- `PATCH /api/leads/:id` — Update lead
- `DELETE /api/leads/:id` — Delete lead

### Properties
- `GET /api/properties` — List properties
- `POST /api/properties` — Create property
- `PATCH /api/properties/:id` — Update property
- `DELETE /api/properties/:id` — Delete property

### Site Visits
- `GET /api/site-visits` — List visits
- `POST /api/site-visits` — Schedule visit (auto-updates lead score)
- `PATCH /api/site-visits/:id` — Update visit status

### Calls
- `POST /api/calls/outbound` — Initiate outbound call `{ phone, leadId? }`

### Conversations
- `GET /api/conversations/:leadId` — Get full transcript for a lead

## Testing

```bash
pnpm test
```

Coverage targets: 80%+

## Health Checks

- `GET /health` — Liveness check
- `GET /ready` — Readiness check (includes DB connectivity)
