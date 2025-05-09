# Product Requirements Document (PRD)

## 1  Overview

Toksta’s community of indie hackers needs a fast, conversational way to discover the right SaaS tools without wading through long listicles or 30‑minute YouTube reviews. The **AI Software Discovery Chat** is an MVP web app built with the Vercel AI SDK. It draws from two knowledge layers:

* **Product Facts (≈ 2 000 rows)** – stored in Airtable and pre‑embedded into an in‑repo JSON file for ultra‑fast in‑memory similarity search.
* **Rich Context (YouTube transcript chunks, ≈ 50 000 vectors)** – stored in a free **Supabase Postgres + pgvector** cluster and used only when deeper answers are needed.

When a user asks for e.g. “Mixpanel alternative”, the chat:

1. Retrieves the top‑5 tools via the local in‑memory vector index.
2. Pulls the three most relevant transcript chunks for each of those tools from Supabase.
3. Streams a concise answer and shows five expandable cards (logo, nutshell, features, influencer count, Reddit sentiment, screenshots, visit‑site link).
4. Falls back to an unrestricted transcript search if the shortlist score is low.

## 2  Goals & Success Metrics

| Goal                 | KPI                                 | Target            |
| -------------------- | ----------------------------------- | ----------------- |
| Drive tool discovery | **Outbound clicks** on “Visit site” | ≥ 5 % CTR/session |
| Fast UX              | p95 time‑to‑first‑token             | ≤ 7 s             |
| Accurate answers     | User thumb‑up rate                  | ≥ 80 %            |

## 3  Personas

* **Indie Hacker Tom** – Solo builder hunting cheap analytics tools.
* **SaaS Marketer Maya** – Needs quick competitive comparisons.

## 4  Scope (MVP)

### 4.1  In Scope

1. **Chat interface** via Vercel AI SDK (Next.js 14) launched from Webflow button (`chat.toksta.com`).
2. **Vector search pipeline**

   * **Product index** – `tools_vectors.json` committed to repo; loaded into memory on first edge‑function hit.
   * **Transcript index** – Supabase pgvector table (`transcript_chunks`).
3. **Result presentation**

   * Five compact cards: logo, nutshell, 3 features, **Influencer badge**, **Reddit sentiment icon** (👍/😐/👎), expandable screenshots (up to 4), “Visit site” link (prefer `Affiliate link`, else official site).
4. **Follow‑up Q\&A** – hidden transcript chunks fed to LLM; no verbatim quotes.
5. **Fallback ranking** – if shortlist score < 0.4, run unfiltered transcript search.
6. **No auth** – public beta, 60 queries/IP/day soft cap.
7. **Analytics** – outbound click + basic usage via Vercel Analytics.

### 4.2  Out of Scope (MVP)

* User accounts & saved lists
* Price‑tier UI (data not available yet)
* Real‑time updates (< day)

## 5  Functional Requirements

| ID   | Title                 | Description                                                                                                   |
| ---- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| FR‑1 | Query Intake          | Accept natural‑language queries.                                                                              |
| FR‑2 | Product Vector Search | Embed query; cosine‑sim over in‑memory product vectors; return top‑5 IDs.                                     |
| FR‑3 | Transcript Retrieval  | For those IDs, query Supabase vector index (`product_id IN (…)`) to fetch top‑3 chunks each.                  |
| FR‑4 | Card Rendering        | Render 5 cards inline with logo, nutshell, 3 features, influencer badge, sentiment icon, gallery, visit link. |
| FR‑5 | Follow‑up Context     | Maintain chat memory, re‑use transcript chunks.                                                               |
| FR‑6 | Fallback Search       | If shortlist score low, run global transcript search; label answer “broader context”.                         |
| FR‑7 | Analytics Event       | Fire `outbound_click` with tool‑ID.                                                                           |

## 6  Non‑Functional Requirements

* **Performance** – p95 ≤ 7 s (includes Supabase round‑trip when needed).
* **Scalability** – 50 concurrent sessions; Edge Functions autoscale.
* **Freshness** – Weekly batch job regenerates all embeddings (facts + transcripts).
* **Security** – Airtable & Supabase keys stored in Vercel env vars; GDPR‑aligned; transcripts contain no personal data.
* **Accessibility** – WCAG 2.1 AA; dark‑mode.

## 7  Data Model Overview

### 7.1  Product Facts (Airtable → in‑repo JSON)

| Field                  | Notes                      |
| ---------------------- | -------------------------- |
| `id`                   | Airtable record ID         |
| `name`                 | Product name               |
| `nutshell`             | Short blurb                |
| `features`             | Array of 3 bullets         |
| `influencer_count`     | Numeric badge              |
| `reddit_sentiment_raw` | Float – mapped to 👍/😐/👎 |
| `logo_url`             | Variable size              |
| `screenshot_urls[4]`   | Gallery                    |
| `affiliate_link`       | Preferred outbound         |
| `website`              | Fallback outbound          |
| `subcategory_list`     | Up to 2, comma‑sep         |
| `embedding`            | 1 536‑float vector         |

### 7.2  Transcript Chunks (Supabase)

| Column         | Type                     |
| -------------- | ------------------------ |
| `chunk_id`     | UUID                     |
| `product_id`   | FK to `id`               |
| `text_excerpt` | VARCHAR (800 tokens max) |
| `embedding`    | VECTOR(1 536)            |
| `chunk_index`  | INT                      |

## 8  System Architecture

```
           ┌────────── Webflow button opens ──────────┐
           │                                          │
[Client]──chat.toksta.com──▶ [Vercel Edge Function]───┼─▶ [Airtable API]  (rare; only for weekly batch)
           │            │                             │
           │            │ fetch product vectors (in‑repo)
           │            └─► in‑memory cosine search (2 k)
           │                      │
           │               top‑5 product IDs
           │                      ▼
           │            ┌──────── Supabase pgvector ──┐
           │            │  filtered similarity search │
           │            └─────────────────────────────┘
           ▼
     stream answer + cards
```

## 9  Embeddings & Refresh Jobs

* **One‑off import script** (Cursor):

  * Pull Airtable rows & YouTube transcripts.
  * Chunk transcripts (\~800 tokens each).
  * Call OpenAI `text‑embedding‑3‑small`.
  * Write `tools_vectors.json` → repo.
  * Bulk‑insert chunks into Supabase.
* **Weekly GitHub Action** re‑runs import.

## 10  Milestones (4‑Week Sprint)

| Week | Deliverables                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------- |
| 1    | Repo + Supabase project; write import script; generate first vectors; basic chat UI scaffold       |
| 2    | In‑memory product search, card component, Supabase integration, transcript retrieval logic         |
| 3    | Follow‑up Q\&A, fallback transcript search, influencer + sentiment badges, outbound click tracking |
| 4    | Load test, edge deploy, Webflow button integration, launch                                         |

## 11  Risks & Mitigations

| Risk                           | Mitigation                                                |
| ------------------------------ | --------------------------------------------------------- |
| Supabase free tier rate‑limits | Cache top‑15 transcript chunks in edge memory per request |
| Large cold‑start assets        | Compress `tools_vectors.json` (≤ 3 MB gz) and lazy‑load   |
| LLM hallucinations             | Cite source: "(context from Toksta transcript)"           |

## 12  Future Enhancements

* Price‑tier data & filters
* User accounts + saved shortlists
* Real‑time embeddings via webhook on new YouTube videos
* Hybrid keyword/vector search with Typesense if scale demands
