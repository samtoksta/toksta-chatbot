Okay, I understand. The goal is to restructure the PRD (v1.1) to align better with the best practices for being consumed by AI development assistants like Cursor, making it a more effective "source of truth" for the AI. This involves emphasizing clear sections, explicit user stories with bulleted acceptance criteria, clearly stated constraints, and detailed technical requirements, all formatted consistently.

Here is the amended PRD (v1.2), restructured according to those principles:

---

# Product Requirements Document (PRD) - AI Software Discovery Chat (v1.2)

**Document Purpose:** This document outlines the requirements for the MVP of the AI Software Discovery Chat for Toksta. It serves as the blueprint for development, guiding both human developers and AI assistants like Cursor.

## 1. Introduction & Problem Statement

Toksta’s community of indie hackers and SaaS marketers needs a faster, more conversational method to discover relevant SaaS tools. Current methods like long listicles or lengthy video reviews are time-consuming and inefficient for quickly finding specific solutions or comparisons.

## 2. Solution Overview

We will build an MVP web application, the **AI Software Discovery Chat** (`chat.toksta.com`), using the Vercel AI SDK and Next.js 14. This chat interface will provide concise, AI-generated answers based on two knowledge layers:

1.  **Product Facts:** A fast, in-memory index (~2,000 tools) derived from Airtable data (stored in `tools_vectors.json` in the repo) for quick lookups.
2.  **Rich Context:** A larger vector index (~50,000 chunks) of YouTube transcript excerpts stored in Supabase (Postgres + pgvector, free tier) for deeper contextual answers when needed.

The system will perform similarity searches on these layers to generate answers and display key tool information in interactive cards.

## 3. Goals & Success Metrics

| Goal                 | KPI                                             | Target            |
| :------------------- | :---------------------------------------------- | :---------------- |
| Drive tool discovery | Outbound clicks on “Visit site”                 | ≥ 5 % CTR/session |
| Fast UX              | p95 time‑to‑first‑token (TTFT)                  | ≤ 7 s             |
| Accurate answers     | User thumb‑up rate                              | ≥ 80 %            |
| User Engagement      | Average queries per session                     | ≥ 3               |
| Context Relevance    | Fallback search activation rate (low score)     | ≤ 15%             |

## 4. Personas

*   **Indie Hacker Tom:** Solo builder searching for cost-effective analytics tools.
*   **SaaS Marketer Maya:** Needs rapid competitive analysis and tool comparisons.

## 5. User Stories & Acceptance Criteria

**US1: Discovering Relevant Tools**
*   **User Story:** *As an indie hacker or SaaS marketer, I want to ask natural language questions about SaaS tools (e.g., alternatives, features, use cases), so that I can quickly find software relevant to my needs.*
*   **Acceptance Criteria:**
    *   [ ] The chat interface accepts user queries in natural language. (Ref: FR-1)
    *   [ ] The system embeds the user query using an appropriate AI model (e.g., `text-embedding-3-small`). (Ref: FR-2)
    *   [ ] The system performs a cosine similarity search against the in-memory product fact vectors (`tools_vectors.json`) to identify the top 5 potentially relevant tools. (Ref: FR-2)
    *   [ ] For these top 5 tools, the system queries the Supabase transcript vector index to retrieve the top 3 most relevant transcript chunks for each tool based on the query. (Ref: FR-3)
    *   [ ] If the highest similarity score from the initial product fact search (FR-2) is below a defined threshold (initially 0.4, subject to tuning), the system triggers a fallback search. (Ref: FR-6)
    *   [ ] The fallback search performs a similarity search directly against the entire Supabase transcript index, without filtering by product ID. (Ref: FR-6)
    *   [ ] Answers generated using the fallback search mechanism are clearly labeled as derived from "broader context". (Ref: FR-6)
    *   [ ] The system fires a `query_submitted` analytics event upon receiving a query. (Ref: FR-7)

**US2: Evaluating Recommendations**
*   **User Story:** *As a user receiving recommendations, I want to see a concise AI-generated summary and key details for each suggested tool presented clearly, so that I can quickly evaluate their suitability.*
*   **Acceptance Criteria:**
    *   [ ] The system streams an AI-generated textual answer summarizing the findings.
    *   [ ] Alongside the text, the system renders 5 compact, expandable cards representing the top recommended tools. (Ref: FR-4)
    *   [ ] Card data is streamed alongside text using Vercel AI SDK structured data capabilities (e.g., `streamObject` or `createDataStream`). (Ref: FR-4)
    *   [ ] Each card displays:
        *   [ ] Tool Logo (`logo_url`)
        *   [ ] Tool Name (`name`)
        *   [ ] Nutshell description (`nutshell`)
        *   [ ] 3 Key Features (`features` array)
        *   [ ] Influencer Badge (based on `influencer_count`)
        *   [ ] Reddit Sentiment Icon (👍/😐/👎 derived from `reddit_sentiment_raw`)
        *   [ ] Expandable Screenshot Gallery (up to 4 images from `screenshot_urls`)
        *   [ ] "Visit Site" link (using `affiliate_link` if available, otherwise `website`). (Ref: Scope 4.1.3)
    *   [ ] The system fires a `tool_impression` analytics event for each tool card displayed. (Ref: FR-7)
    *   [ ] Clicking the "Visit Site" link fires an `outbound_click` analytics event including the `tool-ID`. (Ref: FR-7)
    *   [ ] Users can provide feedback (thumb up/down) on the response, triggering a `feedback_provided` analytics event. (Ref: Goals, Analytics)

**US3: Exploring Deeper**
*   **User Story:** *As a user reviewing recommendations, I want to ask follow-up questions about the suggested tools or related topics, so that I can get more specific details or clarify information without starting a new search.*
*   **Acceptance Criteria:**
    *   [ ] The chat interface maintains conversation history within the current user session. (Ref: FR-5)
    *   [ ] The system uses relevant context (previously fetched or newly fetched product facts and transcript chunks) to generate answers for follow-up questions. (Ref: FR-5)
    *   [ ] The context passed to the LLM for follow-up answers is managed effectively to stay within the model's token limits (e.g., by selection or summarization). (Ref: FR-5 update)
    *   [ ] AI-generated answers for follow-up questions do not include direct, verbatim quotes from the source transcripts. (Ref: Scope 4.1.4)

## 6. Scope (MVP)

### 6.1 In Scope

*   Chat interface (Vercel AI SDK, Next.js 14) launched from `chat.toksta.com`.
*   Two-layer vector search pipeline (in-memory JSON + Supabase pgvector).
*   Result presentation with streamed text and 5 interactive tool cards.
*   Follow-up question handling using retrieved context.
*   Fallback search mechanism for low-confidence initial results.
*   Public beta access (no authentication).
*   Soft rate limiting (60 queries/IP/day).
*   Analytics via Vercel Analytics (covering events specified in ACs).

### 6.2 Out of Scope

*   User accounts, saved lists, or persistent chat history.
*   Display or filtering based on price tiers.
*   Real-time data updates (updates are batch processed weekly).

## 7. Constraints

*   **Technology Stack:** Must use Vercel AI SDK, Next.js 14.
*   **Data Storage:**
    *   Product facts + embeddings: In-repository JSON file (`tools_vectors.json`), loaded into memory.
    *   Transcript chunks + embeddings: Supabase Postgres database with pgvector extension (initially targeting the free tier).
*   **Data Freshness:** Data and embeddings are refreshed via a weekly batch job. Real-time updates are out of scope for MVP.
*   **Authentication:** MVP is public; no user login required.
*   **Rate Limiting:** Implement a soft limit of 60 queries per IP address per day.
*   **Accessibility:** Must meet WCAG 2.1 Level AA standards. Dark mode required.

## 8. Technical Requirements

*   **Architecture:**
    *   Client (React/Next.js with Vercel AI SDK `useChat` hook) interacts with a Vercel Edge Function (Next.js API Route).
    *   Edge Function orchestrates query embedding, in-memory search, Supabase search, context preparation, LLM call, and response streaming (text + structured card data).
    *   Weekly batch job (e.g., GitHub Action) pulls data from Airtable/YouTube, generates embeddings, updates `tools_vectors.json`, and updates Supabase.
    ```
               ┌────────── Webflow button opens ──────────┐
               │                                          │
    [Client]──chat.toksta.com──▶ [Vercel Edge Function]───┼─▶ [Airtable API]  (rare; weekly batch)
    (React, Vercel AI SDK)│            │(Next.js API Route)│
               │            │                             │
               │            │ fetch product vectors (in‑repo JSON)
               │            └─► In-memory cosine search (2k vectors)
               │                      │ *Handles streaming text & card data via SDK*
               │               top‑5 product IDs
               │                      ▼
               │            ┌──────── Supabase pgvector ──┐
               │            │  Filtered similarity search │
               │            │ (for top-5 IDs or fallback) │
               │            └─────────────────────────────┘
               ▼                              │
         Streamed Response + UI Update        │
         (Text + Structured Card Data)        │
               │                              │
               └──────────────────────────────┘
    ```
*   **Data Models:**
    *   **Product Facts (`tools_vectors.json` structure):**
        | Field                  | Type          | Notes                                        |
        | :--------------------- | :------------ | :------------------------------------------- |
        | `id`                   | String        | Airtable record ID                           |
        | `name`                 | String        | Product name                                 |
        | `nutshell`             | String        | Short blurb                                  |
        | `features`             | Array[String] | 3 key feature bullets                        |
        | `influencer_count`     | Number        | Numeric value for badge                      |
        | `reddit_sentiment_raw` | Float         | Mapped to 👍/😐/👎 UI icon                    |
        | `logo_url`             | String (URL)  | URL to product logo                          |
        | `screenshot_urls`   | Array[String] | URLs for image gallery (up to 4)             |
        | `affiliate_link`       | String (URL)  | Preferred outbound URL (nullable)            |
        | `website`              | String (URL)  | Fallback outbound URL                        |
        | `subcategory_list`     | String        | Up to 2 relevant subcategories, comma-sep    |
        | `embedding`            | Array[Float]  | 1536-dim vector (`text-embedding-3-small`) |
    *   **Transcript Chunks (Supabase Table `transcript_chunks`):**
        | Column         | Type            | Notes                                    |
        | :------------- | :-------------- | :--------------------------------------- |
        | `chunk_id`     | UUID            | Primary key                              |
        | `product_id`   | VARCHAR         | FK to Product Facts `id` (Airtable ID)   |
        | `text_excerpt` | TEXT            | Transcript chunk (target max 800 tokens) |
        | `embedding`    | VECTOR(1536)    | Embedding of `text_excerpt`              |
        | `chunk_index`  | INT             | Order within the original transcript     |
        | `source_url`   | VARCHAR (URL)   | Optional: URL of the source YouTube video|
*   **Embeddings:**
    *   Use OpenAI `text-embedding-3-small` (1536 dimensions).
    *   Transcripts are chunked (target ~800 tokens max per chunk) before embedding.
    *   Process managed by a script (e.g., Python) triggered weekly.
*   **Performance:**
    *   Target p95 Time To First Token (TTFT) of ≤ 7 seconds for responses.
    *   Optimize for Vercel Edge Function cold starts, especially the loading of the ~3MB compressed `tools_vectors.json`. Acknowledge potentially higher latency for the very first request after inactivity.
*   **Scalability:**
    *   Architecture should support an *expected* peak load of 50 concurrent user sessions.
    *   Vercel Edge Functions provide auto-scaling.
    *   Monitor Supabase free tier limitations (connections, query performance) as the primary potential bottleneck.
*   **Security:**
    *   API keys (Airtable, Supabase, OpenAI) must be stored securely as Vercel Environment Variables.
    *   Implementation should align with GDPR principles.
    *   Ensure no Personal Identifiable Information (PII) is included in the transcript data stored in Supabase.
*   **Analytics:**
    *   Implement event tracking using Vercel Analytics.
    *   Required Events: `session_start`, `query_submitted`, `tool_impression` (per card), `outbound_click` (with tool ID), `feedback_provided` (thumb up/down, with response ID), `fallback_triggered`.
*   **Error Handling:**
    *   Implement graceful error handling for API failures (Supabase, LLM), embedding issues, or timeouts.
    *   Provide user-friendly error messages in the chat interface (e.g., "Sorry, I couldn't retrieve that information right now. Please try again.").
    *   Log errors comprehensively on the server-side (Vercel Functions logs) for debugging.

## 9. Milestones (4-Week Sprint Target)

| Week | Deliverables                                                                                                                                 |
| :--- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Project Setup (Repo, Next.js, Supabase). Initial data import/embedding script created. First data loaded (`.json` file + Supabase). Basic chat UI scaffold (Vercel AI SDK). |
| 2    | Implement in-memory product search logic. Build tool card React component. Integrate Supabase client & transcript retrieval. Basic text streaming operational. |
| 3    | Implement follow-up question context management & fallback search logic. Add UI elements (badges, sentiment icons). Implement core analytics events (clicks, feedback). |
| 4    | Implement structured data streaming for cards. Performance tuning (cold starts). Finalize error handling. Deploy to Vercel Edge. Integrate Webflow button. Launch Beta. |

## 10. Risks & Mitigations

| Risk                                       | Mitigation                                                                                                                                                                                                |
| :----------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supabase free tier performance/rate‑limits | Monitor Supabase usage dashboard. Cache frequently accessed data if needed (e.g., top transcript chunks per request). Evaluate upgrading tier post-MVP based on performance and usage data.                |
| Large cold‑start asset (`tools_vectors.json`) | Ensure file is compressed (target ≤ 3 MB gzipped). Lazy-load in edge function. Monitor p95 cold start TTFT closely via Vercel Analytics. Accept potential initial slowness.                                |
| LLM hallucinations / Irrelevant Answers    | Ground LLM prompts with specific retrieved context (facts + transcripts). Tune prompts for accuracy and conciseness. Monitor user feedback (thumb ratings) to identify issues.                              |
| Context Window Limits                      | Implement logic to select or summarize context (transcript excerpts) passed to the LLM, ensuring total size remains within model limits, especially for follow-up questions.                                |
| Data Sync Failures (Weekly Job)            | Add monitoring and alerting to the weekly refresh job (e.g., GitHub Action notifications) to detect failures in data pulling, embedding, or database updates.                                               |

## 11. Future Enhancements

*   Integrate price-tier data and allow filtering/comparison based on price.
*   Implement user accounts for saving tool shortlists and chat history.
*   Develop more real-time data update mechanisms (e.g., webhooks, scheduled checks via Vercel Cron Jobs).
*   Explore hybrid search (vector + keyword) if pure vector search proves insufficient for some query types.
*   Add functionality for direct comparison of 2-3 selected tools.
*   Potential integration with broader Toksta platform features/user profiles.

---