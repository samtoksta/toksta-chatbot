# Toksta Chatbot

This repository contains the chatbot implementation for Toksta, featuring semantic search with OpenAI embeddings.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up Python dependencies (required for tiktoken):
   ```bash
   pip install tiktoken
   ```

3. Configure environment variables in `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   OPENAI_API_KEY=your_openai_api_key
   AIRTABLE_API_KEY=your_airtable_api_key
   AIRTABLE_BASE_ID=your_airtable_base_id
   AIRTABLE_TABLE_ID=your_airtable_table_id
   AIRTABLE_TABLE_NAME=your_airtable_table_name
   ```

## Data Seeding

The seed script fetches product data from Airtable, creates embeddings using OpenAI, and stores the data in Supabase for vector search.

### Improved Token Handling

The seed script now uses OpenAI's `tiktoken` library for accurate token counting and text chunking. This ensures:

- Precise token count measurement instead of character-based estimation
- Optimal chunk sizing that doesn't exceed OpenAI's context limits
- More reliable embedding generation

### Running the Seed Script

#### On Windows:
```bash
scripts/seed.bat
```

#### On Unix/Mac:
```bash
./scripts/seed.sh
```

Or run with ts-node directly:
```bash
npx ts-node scripts/seed.ts
```

## Testing

Test the tiktoken bridge to ensure proper token counting and chunking:
```bash
node scripts/test_tiktoken.js
```

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
