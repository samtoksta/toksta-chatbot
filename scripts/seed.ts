import dotenv from 'dotenv';
import path from 'path';
import fsPromises from 'fs/promises'; // Use fsPromises for async file operations
import fs from 'fs'; // For synchronous existsSync
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import Airtable, { FieldSet } from 'airtable'; // Removed Records as it's not explicitly used after this
import { v4 as uuidv4 } from 'uuid';
import { countTokens, chunkText } from './tiktoken_utils';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// --- Configuration & Clients ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const openAIApiKey = process.env.OPENAI_API_KEY;
const airtableApiKey = process.env.AIRTABLE_API_KEY;
const airtableBaseId = process.env.AIRTABLE_BASE_ID;
const airtableTableId = process.env.AIRTABLE_TABLE_ID;
const airtableTableName = process.env.AIRTABLE_TABLE_NAME;

const embeddingModel = 'text-embedding-3-small';

// Maximum token limits
const MAX_EMBEDDING_TOKENS_API_LIMIT = 8191; // Actual OpenAI API limit for text-embedding-3-small
const TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT = 1250; // Target tokens per transcript segment
const OVERLAP_SENTENCE_COUNT = 1;

const toolsVectorsPath = path.resolve(process.cwd(), 'tools_vectors.json');
const processedTranscriptsPath = path.resolve(process.cwd(), 'processed_transcripts_with_products.json');
const supabaseTableName = 'transcript_chunks';

if (
  !supabaseUrl ||
  !supabaseAnonKey ||
  !openAIApiKey || 
  !airtableApiKey || 
  !airtableBaseId || 
  (!airtableTableId && !airtableTableName)
) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, OPENAI_API_KEY, AIRTABLE_API_KEY, AIRTABLE_BASE_ID, and either AIRTABLE_TABLE_ID or AIRTABLE_TABLE_NAME'
  );
}

const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!); 
const openai = new OpenAI({ apiKey: openAIApiKey });
Airtable.configure({ apiKey: airtableApiKey });
const base = Airtable.base(airtableBaseId!);
const table = airtableTableId ? base(airtableTableId) : base(airtableTableName!)

function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  const sentences = text.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

// --- Data Structures ---
interface ProductFact {
  id: string; 
  name: string;
  nutshell: string;
  features: string[];
  influencer_count: number;
  reddit_sentiment_raw: number;
  logo_url: string;
  screenshot_urls: string[];
  affiliate_link: string | null;
  website: string;
  subcategory_list: string;
  descriptionText?: string; 
  tokstaTakeText?: string;
}

interface ProcessedTranscriptProductMention {
    tool_name: string | null;
    link: string | null;
    description: string | null;
    images: string[];
    airtable_product_record_id: string;
}

interface ProcessedTranscriptEntry {
    airtable_transcript_record_id: string;
    transcript_text: string;
    mentioned_products: ProcessedTranscriptProductMention[];
}

interface SupabaseDocument {
    chunk_id: string; 
    product_id: string | null; 
    text_excerpt: string; 
    embedding: number[];
    metadata: Record<string, any>; 
}

// Airtable field names (ensure this map is complete and correct as per your Airtable setup)
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
    subcategories: 'Name (from Subcategory)', 
    description: 'Description', // Crucial for embedding text
    toksta_take: "Toksta's Take" // Crucial for embedding text
};

// --- Helper Functions ---
async function generateEmbedding(text: string, textIdentifier: string = "text"): Promise<number[]> {
  const estimatedTokenCount = await countTokens(text, embeddingModel);
  // console.log(` -> Attempting to embed ${textIdentifier}. Token count: ${estimatedTokenCount}`);

  if (estimatedTokenCount === 0) {
    console.warn(` -> Skipping embedding for ${textIdentifier} due to empty text or zero tokens.`);
    return [];
  }

  if (estimatedTokenCount > MAX_EMBEDDING_TOKENS_API_LIMIT) {
    console.warn(` -> Text too long for embedding: ${estimatedTokenCount} tokens exceeds limit of ${MAX_EMBEDDING_TOKENS_API_LIMIT}.`);
    return [];
  }
  
  try {
    const response = await openai.embeddings.create({
      model: embeddingModel,
      input: text.replace(/\n/g, ' '),
      dimensions: 1536, 
    });
    return response.data[0].embedding;
  } catch (error: any) {
    const errorMessage = error.error?.message || error.message || 'Unknown embedding error';
    console.error(`Error generating embedding for ${textIdentifier} (Tokens: ${estimatedTokenCount}): ${errorMessage}`);
    if (errorMessage.includes("maximum context length")) {
        console.error(` -> This error indicates the input text was too long for the OpenAI API.`);
        console.error(` -> Problematic text (first 100 chars): "${text.substring(0,100)}..."`);
    }
    return []; 
  }
}

async function fetchAllAirtableRecords(tableNameOrId: string): Promise<Airtable.Record<FieldSet>[]> {
    console.log(`Fetching all records from Airtable table: ${tableNameOrId}...`);
    const allRecords: Airtable.Record<FieldSet>[] = []; 
    try {
        const fieldsToFetch = Object.values(AIRTABLE_FIELD_MAP);
        
        await table.select({ 
            fields: fieldsToFetch, 
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
        const name = (fields[AIRTABLE_FIELD_MAP.name] as string || '').trim();
        const website = (fields[AIRTABLE_FIELD_MAP.website] as string || '').trim();
        const nutshell = (fields[AIRTABLE_FIELD_MAP.nutshell] as string || '').trim();
        const logo_url = (fields[AIRTABLE_FIELD_MAP.logo_url] as string || '').trim();
        const influencer_count_raw = fields[AIRTABLE_FIELD_MAP.influencer_count]; 
        const descriptionText = (fields[AIRTABLE_FIELD_MAP.description] as string || '').trim(); 
        const tokstaTakeText = (fields[AIRTABLE_FIELD_MAP.toksta_take] as string || '').trim(); 
        const subcatArray = fields[AIRTABLE_FIELD_MAP.subcategories] as string[] | undefined;
        const subcategory_list = Array.isArray(subcatArray) ? subcatArray.join(', ') : '';
        
        const features = [
            fields[AIRTABLE_FIELD_MAP.feature1],
            fields[AIRTABLE_FIELD_MAP.feature2],
            fields[AIRTABLE_FIELD_MAP.feature3], // Corrected: AIRTABLE_FIELD_MAP
        ].filter((f): f is string => typeof f === 'string' && f.trim().length > 0);

        const screenshots = [
            fields[AIRTABLE_FIELD_MAP.screenshot1_url],
            fields[AIRTABLE_FIELD_MAP.screenshot2_url],
            fields[AIRTABLE_FIELD_MAP.screenshot3_url],
            fields[AIRTABLE_FIELD_MAP.screenshot4_url],
        ].filter((url): url is string => typeof url === 'string' && url.trim().length > 0);

        let missingFields: string[] = [];
        if (!name) missingFields.push('Name');
        if (!website) missingFields.push('Website');
        if (!nutshell) missingFields.push('Nutshell');
        if (!descriptionText) missingFields.push('Description'); 
        if (!tokstaTakeText) missingFields.push("Toksta's Take"); 
        if (features.length === 0) missingFields.push('Features (at least 1)');
        if (influencer_count_raw === null || influencer_count_raw === undefined) missingFields.push('Influencer Count');
        if (!logo_url) missingFields.push('Logo URL');
        if (screenshots.length === 0) missingFields.push('Screenshots (at least 1)');
        if (!subcategory_list) missingFields.push('Subcategories');

        if (missingFields.length > 0) {
            console.warn(`Skipping record ${recordId} (${name || 'No Name'}): Missing required field(s): ${missingFields.join(', ')}.`);
            return null;
        }

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
            descriptionText: descriptionText, // Pass through for embedding text construction
            tokstaTakeText: tokstaTakeText // Pass through for embedding text construction
        };
    } catch (error) {
        console.error(`Error mapping record ${recordId}:`, error);
        return null;
    }
}

async function finalizeChunk(
    chunkSentences: string[],
    chunkIndex: number,
    originalTranscriptId: string,
    allMentionedProductsInTranscript: ProcessedTranscriptProductMention[],
    chunksForSupabase: Array<{ textToEmbed: string, metadata: Record<string, any> }>
) {
    if (chunkSentences.length === 0) return;

    const transcriptChunkText = chunkSentences.join(' ');
    let textToEmbed = `Transcript (Part ${chunkIndex + 1} of TBD): ${transcriptChunkText}\n\n`; 
    let productsMentionedInThisChunkText = "";
    let relevantProductNames: string[] = [];

    for (const product of allMentionedProductsInTranscript) {
        if (product && product.tool_name && transcriptChunkText.toLowerCase().includes(product.tool_name.toLowerCase())) {
            relevantProductNames.push(product.tool_name);
        }
    }

    if (relevantProductNames.length > 0) {
        productsMentionedInThisChunkText = "Mentioned in this segment: " + relevantProductNames.join(', ') + ".";
    }
    
    const potentialTextToEmbed = textToEmbed + productsMentionedInThisChunkText;
    const finalTokenCount = await countTokens(potentialTextToEmbed, embeddingModel);

    if (finalTokenCount > MAX_EMBEDDING_TOKENS_API_LIMIT) {
        console.warn(` -> Chunk ${chunkIndex + 1} for transcript ${originalTranscriptId} (products added, ${finalTokenCount} tokens) too long. Embedding transcript part only.`);
        textToEmbed = `Transcript (Part ${chunkIndex + 1} of TBD): ${transcriptChunkText}`; 
        const transcriptOnlyTokens = await countTokens(textToEmbed, embeddingModel);
        if (transcriptOnlyTokens > MAX_EMBEDDING_TOKENS_API_LIMIT) {
            console.error(` -> CRITICAL: Chunk ${chunkIndex + 1} (transcript part only) for ${originalTranscriptId} STILL too long: ${transcriptOnlyTokens} tokens. SKIPPING.`);
            return; 
        }
    } else {
        textToEmbed = potentialTextToEmbed; 
    }
    
    chunksForSupabase.push({
        textToEmbed: textToEmbed,
        metadata: {
            type: 'transcript_chunk',
            airtable_transcript_record_id: originalTranscriptId,
            chunk_index: chunkIndex,
            total_chunks: 0, // Placeholder, updated later
            original_transcript_text_chunk: transcriptChunkText,
            mentioned_products_details: allMentionedProductsInTranscript, 
            products_identified_in_segment_text: relevantProductNames 
        }
    });
}

async function createTranscriptChunks(
  originalTranscriptText: string,
  allMentionedProductsInTranscript: ProcessedTranscriptProductMention[],
  originalTranscriptId: string
): Promise<Array<{ textToEmbed: string, metadata: Record<string, any> }>> {
  const chunksForSupabase: Array<{ textToEmbed: string, metadata: Record<string, any> }> = [];
  if (!originalTranscriptText || originalTranscriptText.trim().length === 0) {
    console.warn(`Skipping chunking for empty transcript ID: ${originalTranscriptId}`);
    return chunksForSupabase;
  }

  // Now using tiktoken for proper chunking by tokens
  try {
    // First try to chunk directly with tiktoken for better accuracy
    const chunks = await chunkText(
      originalTranscriptText,
      TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT,
      embeddingModel,
      Math.floor(TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT * 0.1) // 10% overlap tokens
    );
    
    if (chunks.length > 0) {
      // Process each tiktoken chunk
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const metadata = {
          type: 'transcript_chunk',
          airtable_transcript_record_id: originalTranscriptId,
          chunk_index: i,
          total_chunks: chunks.length,
          original_transcript_text_chunk: chunk,
          mentioned_products_details: allMentionedProductsInTranscript,
          products_identified_in_segment_text: [] as string[]
        };
        
        // Find mentioned products in this chunk
        for (const product of allMentionedProductsInTranscript) {
          if (product && product.tool_name && chunk.toLowerCase().includes(product.tool_name.toLowerCase())) {
            metadata.products_identified_in_segment_text.push(product.tool_name);
          }
        }
        
        // Create the textToEmbed
        let textToEmbed = `Transcript (Part ${i + 1}/${chunks.length}): ${chunk}\n\n`;
        if (metadata.products_identified_in_segment_text.length > 0) {
          textToEmbed += "Mentioned in this segment: " + metadata.products_identified_in_segment_text.join(', ') + ".";
        }
        
        // Check if final text is within token limits
        const finalTokenCount = await countTokens(textToEmbed, embeddingModel);
        if (finalTokenCount <= MAX_EMBEDDING_TOKENS_API_LIMIT) {
          chunksForSupabase.push({
            textToEmbed,
            metadata
          });
        } else {
          console.warn(` -> Chunk ${i + 1} too large with ${finalTokenCount} tokens. Using transcript only.`);
          textToEmbed = `Transcript (Part ${i + 1}/${chunks.length}): ${chunk}`;
          const transcriptOnlyTokens = await countTokens(textToEmbed, embeddingModel);
          
          if (transcriptOnlyTokens <= MAX_EMBEDDING_TOKENS_API_LIMIT) {
            chunksForSupabase.push({
              textToEmbed,
              metadata
            });
          } else {
            console.error(` -> CRITICAL: Chunk ${i + 1} still too large with ${transcriptOnlyTokens} tokens. SKIPPING.`);
          }
        }
      }
      
      return chunksForSupabase;
    }
  } catch (error) {
    console.error(`Error using tiktoken chunking for transcript ${originalTranscriptId}:`, error);
    console.log("Falling back to sentence-based chunking...");
  }

  // Fallback to sentence-based chunking if tiktoken fails
  const sentences = splitIntoSentences(originalTranscriptText);
  if (sentences.length === 0 && originalTranscriptText.length > 0) {
    console.warn(`No sentences found in transcript ID: ${originalTranscriptId}. Handling as single chunk.`);
    const tempTextToEmbed = `Transcript (Part 1/1): ${originalTranscriptText}`;
    const tempTokenCount = await countTokens(tempTextToEmbed, embeddingModel);
    
    if (tempTokenCount <= MAX_EMBEDDING_TOKENS_API_LIMIT) {
        chunksForSupabase.push({
            textToEmbed: tempTextToEmbed,
            metadata: {
                type: 'transcript_chunk', airtable_transcript_record_id: originalTranscriptId,
                chunk_index: 0, total_chunks: 1,
                original_transcript_text_chunk: originalTranscriptText,
                mentioned_products_details: allMentionedProductsInTranscript,
                products_identified_in_segment_text: [] // No specific product id for this raw chunk
            }
        });
    } else {
      console.error(`Single unsplittable chunk for ${originalTranscriptId} too large: ${tempTokenCount} tokens. SKIPPING.`);
    }
    return chunksForSupabase; // total_chunks is already 1 here, no need to update later for this case
  }
  if (sentences.length === 0) return chunksForSupabase; // Truly empty

  let currentChunkSentences: string[] = [];
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const potentialChunkText = [...currentChunkSentences, sentence].join(' ');
    const potentialTokenCount = await countTokens(potentialChunkText, embeddingModel);

    // Check if adding this sentence would make the transcript segment too large
    if (potentialTokenCount < TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT || currentChunkSentences.length === 0) {
      currentChunkSentences.push(sentence);
    } else {
      // Finalize the current chunk (currentChunkSentences BEFORE adding the current sentence)
      await finalizeChunk(currentChunkSentences, chunkIndex, originalTranscriptId, allMentionedProductsInTranscript, chunksForSupabase);
      chunkIndex++;

      // Start new chunk with overlap and current sentence
      const overlapStart = Math.max(0, i - OVERLAP_SENTENCE_COUNT);
      currentChunkSentences = sentences.slice(overlapStart, i + 1); 
    }

    // If it's the last sentence, finalize the current working chunk
    if (i === sentences.length - 1 && currentChunkSentences.length > 0) {
        await finalizeChunk(currentChunkSentences, chunkIndex, originalTranscriptId, allMentionedProductsInTranscript, chunksForSupabase);
    }
  }
  
  // Update total_chunks for all created chunks for this transcript
  chunksForSupabase.forEach(chunk => chunk.metadata.total_chunks = chunksForSupabase.length);
  return chunksForSupabase;
}

// --- PART 3: Upsert all data to Supabase --- 
async function upsertDocumentsToSupabase(documents: SupabaseDocument[]) {
  if (!documents || documents.length === 0) {
    console.log("No documents to upsert to Supabase.");
    return;
  }
  console.log(`\nAttempting to upsert ${documents.length} documents to Supabase table: ${supabaseTableName}...`);

  const batchSize = 100; // Supabase recommends batching for large upserts
  let successfulUpserts = 0;
  let failedUpserts = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    console.log(` -> Upserting batch ${i / batchSize + 1} of ${Math.ceil(documents.length / batchSize)} (${batch.length} documents)...`);
    
    const recordsToUpsert = batch.map(doc => ({
      chunk_id: doc.chunk_id, // Primary key for upsert
      product_id: doc.product_id, // Can be null for transcript-type docs
      text_excerpt: doc.text_excerpt,
      embedding: doc.embedding,
      metadata: doc.metadata, 
      // created_at will be set by Supabase by default if column is configured for it
      // chunk_index: null, // Set if you have this column and a use for it
      // source_url: doc.metadata.source_url || (doc.metadata.type === 'product' ? doc.metadata.website : null), // Example logic if you add source_url later
    }));

    try {
      const { data, error } = await supabase
        .from(supabaseTableName)
        .upsert(recordsToUpsert, { 
            onConflict: 'chunk_id', // Assumes chunk_id is your primary key or has a unique constraint
            // ignoreDuplicates: false // Default is false, set to true if you only want to insert new and not update
         });

      if (error) {
        console.error(`Error upserting batch to Supabase:`, error);
        failedUpserts += batch.length; // Assume all in batch failed if error occurs at batch level
      } else {
        // Supabase .upsert returns an empty data array on success by default unless { count: 'exact' } is specified
        console.log(` -> Batch upserted. Response indicates success (may not have detailed count without 'count' option).`);
        successfulUpserts += batch.length; // Optimistically count batch as success
      }
    } catch (e) {
        console.error('Exception during Supabase upsert:', e);
        failedUpserts += batch.length;
    }
    // Optional: Add a small delay between batches if dealing with very large datasets
    // await new Promise(resolve => setTimeout(resolve, 200)); 
  }
  console.log(`Finished Supabase upsert. Approximated Successful: ${successfulUpserts}, Approximated Failures: ${failedUpserts}`);
}

// --- Main Seeding Logic ---
async function seedData() {
  console.log('Starting data seeding process...');
  let allSupabaseDocuments: SupabaseDocument[] = [];

  // --- 1. Fetch & Process Product Facts from Airtable ---
  const airtableRecords = await fetchAllAirtableRecords(airtableTableId || airtableTableName!); 
  
  const mappedProducts: ProductFact[] = airtableRecords
      .map(recordData => mapAirtableRecordToProduct(recordData))
      .filter((product): product is ProductFact => product !== null);
  
  console.log(`Successfully mapped ${mappedProducts.length} products meeting ALL quality criteria from Airtable.`);
  
  if (mappedProducts.length === 0 && !fs.existsSync(processedTranscriptsPath)) { 
      console.warn('No products mapped from Airtable and no processed transcripts file found. Exiting seed script.');
      return;
  }

  // --- 2. Generate Embeddings for Products ---
  if (mappedProducts.length > 0) {
    console.log(`Generating embeddings for ${mappedProducts.length} products...`);
    let productEmbeddingFailures = 0;
    const productBatchSize = 50;

    for (let i = 0; i < mappedProducts.length; i += productBatchSize) {
        const batch = mappedProducts.slice(i, i + productBatchSize);
        console.log(` -> Processing product batch ${i / productBatchSize + 1} (${batch.length} products)...`);
        
        for (let j = 0; j < batch.length; j++) {
            const product = batch[j];
            
            const textToEmbed = [
                `Name: ${product.name}`,
                `Nutshell: ${product.nutshell}`,
                `Description: ${product.descriptionText}`,
                `Toksta's Take: ${product.tokstaTakeText}`,
                `Features: ${product.features.join(', ')}`,
                `Subcategories: ${product.subcategory_list}`
            ].filter(Boolean).join('\n');
            
            const embedding = await generateEmbedding(textToEmbed);

            if (embedding.length > 0) {
                const { descriptionText, tokstaTakeText, ...productMetadata } = product;
                allSupabaseDocuments.push({
                    chunk_id: uuidv4(),
                    product_id: product.id,
                    text_excerpt: textToEmbed, 
                    embedding: embedding,
                    metadata: { ...productMetadata, type: 'product' }
                });
            } else {
                productEmbeddingFailures++;
                console.warn(` -> Failed to generate embedding for product: ${product.name}`);
            }
        }
    }
    console.log(`Finished product embeddings. Success: ${allSupabaseDocuments.length}, Failures: ${productEmbeddingFailures}`);

    // Optional: Save product vectors to local JSON (tools_vectors.json)
    try {
        const productVectorsForJson = allSupabaseDocuments
          .filter(doc => doc.metadata.type === 'product')
          .map(p => ({ 
              id: p.product_id, 
              name: p.metadata.name, 
              nutshell: p.metadata.nutshell,
              features: p.metadata.features,
              influencer_count: p.metadata.influencer_count,
              reddit_sentiment_raw: p.metadata.reddit_sentiment_raw,
              logo_url: p.metadata.logo_url,
              screenshot_urls: p.metadata.screenshot_urls,
              affiliate_link: p.metadata.affiliate_link,
              website: p.metadata.website,
              subcategory_list: p.metadata.subcategory_list,
              content_for_embedding: p.text_excerpt, 
              embedding: p.embedding 
            }));
        await fsPromises.writeFile(toolsVectorsPath, JSON.stringify(productVectorsForJson, null, 2));
        console.log(`Product data (with embeddings and content) saved to ${toolsVectorsPath}`);
    } catch (error) {
        console.error(`Error writing product data to ${toolsVectorsPath}:`, error);
    }
  } else {
      console.log("No mapped products from Airtable to process for embeddings.");
  }

  // --- PART 2: Load and Process Transcript Data --- 
  console.log("\nAttempting to load and process transcript data...");
  let processedTranscriptEntries: ProcessedTranscriptEntry[] = [];
  try {
    if (fs.existsSync(processedTranscriptsPath)) {
      const transcriptsJson = await fsPromises.readFile(processedTranscriptsPath, 'utf-8');
      processedTranscriptEntries = JSON.parse(transcriptsJson) as ProcessedTranscriptEntry[];
      console.log(` -> Successfully loaded ${processedTranscriptEntries.length} processed transcript entries from ${processedTranscriptsPath}`);
    } else {
      console.log(` -> Processed transcripts file not found at ${processedTranscriptsPath}. Skipping transcript processing.`);
    }
  } catch (error) {
    console.error(`Error loading or parsing ${processedTranscriptsPath}:`, error);
    // Decide if you want to stop the script or continue without transcript data
  }

  if (processedTranscriptEntries.length > 0) {
    console.log(`Chunking and generating embeddings for ${processedTranscriptEntries.length} transcript entries...`);
    let transcriptEmbeddingFailures = 0;
    let totalTranscriptDocumentsCreated = 0;

    for (let i = 0; i < processedTranscriptEntries.length; i++) {
      const entry = processedTranscriptEntries[i];
      console.log(` -> Processing transcript entry ${i + 1}/${processedTranscriptEntries.length}, ID: ${entry.airtable_transcript_record_id}...`);

      const chunksData = await createTranscriptChunks(
        entry.transcript_text,
        entry.mentioned_products,
        entry.airtable_transcript_record_id
      );
      if (chunksData.length === 0) {
          console.warn(` -> No processable chunks for transcript ID: ${entry.airtable_transcript_record_id}. Skipping.`);
          continue;
      }
      console.log(`   -> Created ${chunksData.length} chunks for transcript ID: ${entry.airtable_transcript_record_id}. Generating embeddings...`);

      for (let c = 0; c < chunksData.length; c++) {
        const chunk = chunksData[c];
        const embeddingIdentifier = `Transcript ${chunk.metadata.airtable_transcript_record_id}, Chunk ${chunk.metadata.chunk_index + 1}/${chunk.metadata.total_chunks}`;
        console.log(`     -> [${i+1}/${processedTranscriptEntries.length}] Generating embedding for chunk ${c+1}/${chunksData.length}: ${embeddingIdentifier}`);
        const embedding = await generateEmbedding(chunk.textToEmbed, embeddingIdentifier);
        if (embedding.length > 0) {
          allSupabaseDocuments.push({
            chunk_id: uuidv4(), 
            product_id: null, 
            text_excerpt: chunk.textToEmbed, 
            embedding: embedding,
            metadata: chunk.metadata 
          });
          totalTranscriptDocumentsCreated++;
        } else { 
            transcriptEmbeddingFailures++; 
            console.warn(`     -> Embedding generation FAILED for: ${embeddingIdentifier}`);
        }
      }
      console.log(`   -> Finished embeddings for transcript ID: ${entry.airtable_transcript_record_id}. Total documents created so far: ${totalTranscriptDocumentsCreated}. Failures: ${transcriptEmbeddingFailures}`);
    }
    console.log(`Finished transcript processing. Created ${totalTranscriptDocumentsCreated} transcript chunks/documents. Failures: ${transcriptEmbeddingFailures}`);
  }

  // --- PART 3: Upsert all data to Supabase --- 
  console.log(`\nTotal documents prepared for Supabase: ${allSupabaseDocuments.length}`);
  if (allSupabaseDocuments.length === 0) {
      console.log("No documents to upsert to Supabase. Exiting.");
      return;
  }
  
  await upsertDocumentsToSupabase(allSupabaseDocuments);

  console.log('\nSeeding process completed.');
}

seedData().then(() => {
  console.log('Seed script finished successfully.');
}).catch(error => {
  console.error('Seed script failed:', error);
  process.exit(1);
}); 