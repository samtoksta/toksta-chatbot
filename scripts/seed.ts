import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs/promises';
// import { createClient } from '@supabase/supabase-js'; // Keep commented for now
import OpenAI from 'openai';
import Airtable, { FieldSet, Records } from 'airtable'; // Import Airtable

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// --- Configuration & Clients ---
// const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL; // Keep commented
// const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // Keep commented
const openAIApiKey = process.env.OPENAI_API_KEY;
const airtableApiKey = process.env.AIRTABLE_API_KEY;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
// Use Table ID preferably, fallback to Name if ID is not set
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableTableName = process.env.AIRTABLE_TABLE_NAME;

const embeddingModel = 'text-embedding-3-small';
const toolsVectorsPath = path.resolve(process.cwd(), 'tools_vectors.json');
// const transcriptTableName = 'transcript_chunks'; // Keep commented

if (!openAIApiKey || !airtableApiKey || !airtableBaseId || (!airtableTableId && !airtableTableName)) {
  throw new Error(
    'Missing required environment variables: OPENAI_API_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and either AIRTABLE_TABLE_ID or AIRTABLE_TABLE_NAME'
  );
}

// const supabase = createClient(supabaseUrl!, supabaseAnonKey!); // Keep commented
const openai = new OpenAI({ apiKey: openAIApiKey });
Airtable.configure({ apiKey: airtableApiKey });
const base = Airtable.base(airtableBaseId);
const table = airtableTableId ? base(airtableTableId) : base(airtableTableName!)

// --- Data Structures (Matching PRD/API Response) ---
interface ProductFact {
  id: string;
  name: string;
  nutshell: string;
  features: string[];
  influencer_count: number;
  reddit_sentiment_raw: number; // Will default to 0
  logo_url: string;
  screenshot_urls: string[];
  affiliate_link: string | null;
  website: string;
  subcategory_list: string;
}

interface ProductFactWithEmbedding extends ProductFact {
  embedding: number[];
}

// Airtable field names based on describe_table output and user confirmation
const AIRTABLE_FIELD_MAP = {
    name: 'Product Name',
    nutshell: 'In a Nutshell',
    feature1: 'Feature 1',
    feature2: 'Feature 2',
    feature3: 'Feature 3',
    influencer_count: 'Number of influencers',
    logo_url: 'Product Logo URL',
    screenshot1_url: 'Main Image URL',
    screenshot2_url: 'Image 2 URL',
    screenshot3_url: 'Image 3 URL',
    screenshot4_url: 'Image 4 URL',
    affiliate_link: 'Affiliate Link',
    website: 'Website Address',
    subcategories: 'Name (from Subcategory)', // Lookup field returning array
    description: 'Description',
    toksta_take: "Toksta's Take"
};

// --- Helper Functions ---

async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
      console.warn(' -> Skipping embedding for empty text.');
      return []; // Return empty array for empty text
  }
  try {
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input: text.replace(/\n/g, ' '), // OpenAI recommends replacing newlines
      dimensions: 1536,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error(`Error generating embedding for: ${text.substring(0, 50)}...`, error);
    // Decide if we want to return empty or throw
    // Returning empty allows partial success
    return []; 
  }
}

async function fetchAllAirtableRecords(tableName: string): Promise<Airtable.Records<FieldSet>> {
    console.log(`Fetching all records from Airtable table: ${tableName}...`);
    const allRecords: Airtable.Record<FieldSet>[] = []; 
    try {
        // Ensure ALL fields needed for mapping AND embedding text are fetched
        const fieldsToFetch = Object.values(AIRTABLE_FIELD_MAP);
        
        await table.select({ 
            fields: fieldsToFetch, // Now includes Description and Toksta's Take
            // filterByFormula: '{Approval status} = "Approved"',
            pageSize: 100
        }).eachPage((records, fetchNextPage) => {
            console.log(` -> Fetched ${records.length} records...`);
            allRecords.push(...records); 
            fetchNextPage();
        });
        console.log(` -> Finished fetching. Total records: ${allRecords.length}`);
        return allRecords;
    } catch (error) {
        console.error(`Error fetching records from Airtable:`, error);
        throw error;
    }
}

function mapAirtableRecordToProduct(recordData: Airtable.Record<FieldSet>): ProductFact | null {
    const recordId = recordData.id;
    const fields = recordData.fields;

    if (!fields) {
        console.warn(`Skipping record ${recordId}: Missing fields object.`);
        return null;
    }

    try {
        // --- Retrieve potential values (with fallbacks) ---
        const name = (fields[AIRTABLE_FIELD_MAP.name] as string || '').trim();
        const website = (fields[AIRTABLE_FIELD_MAP.website] as string || '').trim();
        const nutshell = (fields[AIRTABLE_FIELD_MAP.nutshell] as string || '').trim();
        const logo_url = (fields[AIRTABLE_FIELD_MAP.logo_url] as string || '').trim();
        const influencer_count_raw = fields[AIRTABLE_FIELD_MAP.influencer_count]; 
        const descriptionText = (fields[AIRTABLE_FIELD_MAP.description] as string || '').trim(); // Get Description
        const tokstaTakeText = (fields[AIRTABLE_FIELD_MAP.toksta_take] as string || '').trim(); // Get Toksta's Take
        const subcatArray = fields[AIRTABLE_FIELD_MAP.subcategories] as string[] | undefined;
        const subcategory_list = Array.isArray(subcatArray) ? subcatArray.join(', ') : '';
        
        const features = [
            fields[AIRTABLE_FIELD_MAP.feature1],
            fields[AIRTABLE_FIELD_MAP.feature2],
            fields[AIRTABLE_FIELD_MAP.feature3],
        ].filter((f): f is string => typeof f === 'string' && f.trim().length > 0);

        const screenshots = [
            fields[AIRTABLE_FIELD_MAP.screenshot1_url],
            fields[AIRTABLE_FIELD_MAP.screenshot2_url],
            fields[AIRTABLE_FIELD_MAP.screenshot3_url],
            fields[AIRTABLE_FIELD_MAP.screenshot4_url],
        ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

        // --- Stricter Validation (Now includes Description & Toksta's Take) --- 
        let missingFields: string[] = [];
        if (!name) missingFields.push('Name');
        if (!website) missingFields.push('Website');
        if (!nutshell) missingFields.push('Nutshell');
        if (!descriptionText) missingFields.push('Description'); // Added check
        if (!tokstaTakeText) missingFields.push("Toksta's Take"); // Added check
        if (features.length === 0) missingFields.push('Features (at least 1)');
        if (influencer_count_raw === null || influencer_count_raw === undefined) missingFields.push('Influencer Count');
        if (!logo_url) missingFields.push('Logo URL');
        if (screenshots.length === 0) missingFields.push('Screenshots (at least 1)');
        if (!subcategory_list) missingFields.push('Subcategories');

        if (missingFields.length > 0) {
            console.warn(`Skipping record ${recordId} (${name || 'No Name'}): Missing required field(s): ${missingFields.join(', ')}.`);
            return null;
        }

        // --- Construct ProductFact (if validation passes) ---
        // Note: Description and Toksta's Take are NOT included here, only used for validation & embedding
        return {
            id: recordId,
            name: name,
            nutshell: nutshell,
            features: features,
            influencer_count: Number(influencer_count_raw), 
            reddit_sentiment_raw: 0, 
            logo_url: logo_url,
            screenshot_urls: screenshots,
            affiliate_link: (fields[AIRTABLE_FIELD_MAP.affiliate_link] as string || null),
            website: website,
            subcategory_list: subcategory_list,
        };
    } catch (error) {
        console.error(`Error mapping record ${recordId}:`, error);
        return null;
    }
}


// --- Main Seeding Logic ---

async function seedData() {
  console.log('Starting data seeding process from Airtable...');

  // --- 1. Fetch & Process Product Facts from Airtable ---
  const airtableRecords = await fetchAllAirtableRecords(airtableTableId || airtableTableName!); 
  const mappedProducts: ProductFact[] = airtableRecords
      .map(recordData => mapAirtableRecordToProduct(recordData)) // Pass the full record
      .filter((product): product is ProductFact => product !== null);
  
  console.log(`Successfully mapped ${mappedProducts.length} products meeting ALL quality criteria from Airtable.`);
  if (mappedProducts.length === 0) {
      console.warn('No products mapped from Airtable. Exiting seed script.');
      return;
  }

  // --- 2. Generate Embeddings ---
  console.log(`Generating embeddings for ${mappedProducts.length} products...`);
  const productsWithEmbeddings: ProductFactWithEmbedding[] = [];
  let embeddingFailures = 0;
  const batchSize = 50; // Process in batches to manage API calls

  // We need the original records to get the extra fields for embedding text
  const recordMap = new Map(airtableRecords.map(rec => [rec.id, rec.fields]));

  for (let i = 0; i < mappedProducts.length; i += batchSize) {
      const batch = mappedProducts.slice(i, i + batchSize);
      console.log(` -> Processing batch ${i / batchSize + 1} (${batch.length} products)...`);
      
      // Create embedding texts using mapped data AND extra fields from original record
      const textsToEmbed = batch.map(product => {
          const originalFields = recordMap.get(product.id) || {}; // Get original fields
          const descriptionText = (originalFields[AIRTABLE_FIELD_MAP.description] as string || '').trim();
          const tokstaTakeText = (originalFields[AIRTABLE_FIELD_MAP.toksta_take] as string || '').trim();

          // Construct richer text for embedding
          return [
              `Name: ${product.name}`,
              `Nutshell: ${product.nutshell}`,
              `Description: ${descriptionText}`,
              `Toksta's Take: ${tokstaTakeText}`,
              `Features: ${product.features.join(', ')}`,
              `Subcategories: ${product.subcategory_list}`
          ].filter(Boolean).join('\n'); // Filter out empty lines and join
      });
      
      // Generate embeddings for the batch
      for (let j = 0; j < batch.length; j++) {
          const product = batch[j];
          const text = textsToEmbed[j];
          const embedding = await generateEmbedding(text);

          if (embedding.length > 0) {
              productsWithEmbeddings.push({ ...product, embedding });
          } else {
              embeddingFailures++;
              console.warn(` -> Failed to generate embedding for ${product.name} (ID: ${product.id})`);
          }
          await new Promise(resolve => setTimeout(resolve, 100)); 
      }
  }

  console.log(`Finished generating embeddings. Success: ${productsWithEmbeddings.length}, Failures: ${embeddingFailures}`);

  // --- 3. Save `tools_vectors.json` ---
  if (productsWithEmbeddings.length > 0) {
    console.log(`Saving ${productsWithEmbeddings.length} product facts with embeddings to ${toolsVectorsPath}...`);
    await fs.writeFile(toolsVectorsPath, JSON.stringify(productsWithEmbeddings, null, 2));
    console.log(' -> tools_vectors.json saved successfully.');
  } else {
    console.warn('No products with successful embeddings generated. tools_vectors.json not updated.');
  }

  // --- 4. Process Transcript Chunks & Insert into Supabase (COMMENTED OUT) ---
  /*
  console.log(`Processing transcript chunks for Supabase... (Currently skipped)`);
  // ... (Keep existing Supabase logic here if you want to re-enable it later) ...
  // IMPORTANT: If you re-enable this, you'll need to update the 
  // placeholderTranscripts or fetch real transcripts and link them to the 
  // *new* product IDs fetched from Airtable.
  */

  console.log('Airtable data seeding process completed.');
}

// --- Run the script ---
seedData().catch((error) => {
  console.error('Seeding script failed:', error);
  process.exit(1);
}); 