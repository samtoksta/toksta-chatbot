import dotenv from 'dotenv';
import path from 'path';
import fsPromises from 'fs/promises';
import fs from 'fs';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { countTokens, chunkText } from './tiktoken_utils'; // Assuming tiktoken_utils.ts is in the same directory or adjust path

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// --- Configuration & Clients ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const openAIApiKey = process.env.OPENAI_API_KEY;

const embeddingModel = 'text-embedding-3-small';
const MAX_EMBEDDING_TOKENS_API_LIMIT = 8191;
const TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT = 1250;
const OVERLAP_SENTENCE_COUNT = 1; // Used in sentence-based fallback

const processedTranscriptsPath = path.resolve(process.cwd(), 'processed_transcripts_with_products.json');
const supabaseTableName = 'transcript_chunks'; // Same as in seed.ts

// Environment variable validation
if (!supabaseUrl || !supabaseAnonKey || !openAIApiKey) {
  throw new Error(
    'Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, OPENAI_API_KEY'
  );
}

const supabase: SupabaseClient = createClient(supabaseUrl!, supabaseAnonKey!);
const openai = new OpenAI({ apiKey: openAIApiKey });

// --- Data Structures (copied from seed.ts) ---
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

// --- Helper Functions (copied and adapted from seed.ts) ---

function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  // Basic sentence splitting, can be improved for more accuracy
  const sentences = text.replace(/([.?!])\s*(?=[A-Z])/g, "$1|").split("|");
  return sentences.map(s => s.trim()).filter(s => s.length > 0);
}

async function generateEmbedding(text: string, textIdentifier: string = "text"): Promise<number[]> {
  const estimatedTokenCount = await countTokens(text, embeddingModel);
  // console.log(` -> Attempting to embed ${textIdentifier}. Token count: ${estimatedTokenCount}`);

  if (estimatedTokenCount === 0) {
    console.warn(` -> Skipping embedding for ${textIdentifier} due to empty text or zero tokens.`);
    return [];
  }

  if (estimatedTokenCount > MAX_EMBEDDING_TOKENS_API_LIMIT) {
    console.warn(` -> Text for ${textIdentifier} too long for embedding: ${estimatedTokenCount} tokens exceeds limit of ${MAX_EMBEDDING_TOKENS_API_LIMIT}.`);
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

// Simplified finalizeChunk for the test script, directly using what's in createTranscriptChunks fallback
async function finalizeChunkForTesting(
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
        // Added the null check for product as per previous fix
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
        console.warn(` -> [Test] Chunk ${chunkIndex + 1} for transcript ${originalTranscriptId} (products added, ${finalTokenCount} tokens) too long. Embedding transcript part only.`);
        textToEmbed = `Transcript (Part ${chunkIndex + 1} of TBD): ${transcriptChunkText}`;
        const transcriptOnlyTokens = await countTokens(textToEmbed, embeddingModel);
        if (transcriptOnlyTokens > MAX_EMBEDDING_TOKENS_API_LIMIT) {
            console.error(` -> [Test] CRITICAL: Chunk ${chunkIndex + 1} (transcript part only) for ${originalTranscriptId} STILL too long: ${transcriptOnlyTokens} tokens. SKIPPING.`);
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


async function createTranscriptChunksForTesting(
  originalTranscriptText: string,
  allMentionedProductsInTranscript: ProcessedTranscriptProductMention[],
  originalTranscriptId: string
): Promise<Array<{ textToEmbed: string, metadata: Record<string, any> }>> {
  const chunksForSupabase: Array<{ textToEmbed: string, metadata: Record<string, any> }> = [];
  if (!originalTranscriptText || originalTranscriptText.trim().length === 0) {
    console.warn(`[Test] Skipping chunking for empty transcript ID: ${originalTranscriptId}`);
    return chunksForSupabase;
  }

  try {
    const chunks = await chunkText(
      originalTranscriptText,
      TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT,
      embeddingModel,
      Math.floor(TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT * 0.1) // 10% overlap
    );
    
    if (chunks.length > 0) {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const metadata: Record<string, any> = { // Explicitly type metadata
          type: 'transcript_chunk',
          airtable_transcript_record_id: originalTranscriptId,
          chunk_index: i,
          total_chunks: chunks.length,
          original_transcript_text_chunk: chunk,
          mentioned_products_details: allMentionedProductsInTranscript,
          products_identified_in_segment_text: [] as string[]
        };
        
        for (const product of allMentionedProductsInTranscript) {
          // Added the null check for product as per previous fix
          if (product && product.tool_name && chunk.toLowerCase().includes(product.tool_name.toLowerCase())) {
            metadata.products_identified_in_segment_text.push(product.tool_name);
          }
        }
        
        let textToEmbed = `Transcript (Part ${i + 1}/${chunks.length}): ${chunk}\n\n`;
        if (metadata.products_identified_in_segment_text.length > 0) {
          textToEmbed += "Mentioned in this segment: " + metadata.products_identified_in_segment_text.join(', ') + ".";
        }
        
        const finalTokenCount = await countTokens(textToEmbed, embeddingModel);
        if (finalTokenCount <= MAX_EMBEDDING_TOKENS_API_LIMIT) {
          chunksForSupabase.push({ textToEmbed, metadata });
        } else {
          console.warn(` -> [Test] Chunk ${i + 1} (ID: ${originalTranscriptId}) too large with ${finalTokenCount} tokens. Using transcript only.`);
          textToEmbed = `Transcript (Part ${i + 1}/${chunks.length}): ${chunk}`;
          const transcriptOnlyTokens = await countTokens(textToEmbed, embeddingModel);
          
          if (transcriptOnlyTokens <= MAX_EMBEDDING_TOKENS_API_LIMIT) {
            chunksForSupabase.push({ textToEmbed, metadata });
          } else {
            console.error(` -> [Test] CRITICAL: Chunk ${i + 1} (ID: ${originalTranscriptId}) still too large with ${transcriptOnlyTokens} tokens. SKIPPING.`);
          }
        }
      }
      return chunksForSupabase;
    }
  } catch (error) {
    console.error(`[Test] Error using tiktoken chunking for transcript ${originalTranscriptId}:`, error);
    console.log("[Test] Falling back to sentence-based chunking...");
  }

  // Fallback to sentence-based chunking
  const sentences = splitIntoSentences(originalTranscriptText);
  if (sentences.length === 0 && originalTranscriptText.length > 0) {
    console.warn(`[Test] No sentences found in transcript ID: ${originalTranscriptId}. Handling as single chunk.`);
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
                products_identified_in_segment_text: []
            }
        });
    } else {
      console.error(`[Test] Single unsplittable chunk for ${originalTranscriptId} too large: ${tempTokenCount} tokens. SKIPPING.`);
    }
    return chunksForSupabase;
  }
  if (sentences.length === 0) return chunksForSupabase;

  let currentChunkSentences: string[] = [];
  let chunkIndex = 0;

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    const potentialChunkText = [...currentChunkSentences, sentence].join(' ');
    const potentialTokenCount = await countTokens(potentialChunkText, embeddingModel);

    if (potentialTokenCount < TARGET_TOKENS_FOR_TRANSCRIPT_SEGMENT || currentChunkSentences.length === 0) {
      currentChunkSentences.push(sentence);
    } else {
      await finalizeChunkForTesting(currentChunkSentences, chunkIndex, originalTranscriptId, allMentionedProductsInTranscript, chunksForSupabase);
      chunkIndex++;
      const overlapStart = Math.max(0, i - OVERLAP_SENTENCE_COUNT);
      currentChunkSentences = sentences.slice(overlapStart, i + 1);
    }

    if (i === sentences.length - 1 && currentChunkSentences.length > 0) {
        await finalizeChunkForTesting(currentChunkSentences, chunkIndex, originalTranscriptId, allMentionedProductsInTranscript, chunksForSupabase);
    }
  }
  
  chunksForSupabase.forEach(chunk => chunk.metadata.total_chunks = chunksForSupabase.length);
  return chunksForSupabase;
}

async function upsertDocumentsToSupabaseForTesting(documents: SupabaseDocument[]) {
  if (!documents || documents.length === 0) {
    console.log("[Test] No documents to upsert to Supabase.");
    return;
  }
  console.log(`\n[Test] Attempting to upsert ${documents.length} documents to Supabase table: ${supabaseTableName}...`);

  const batchSize = 100;
  let successfulUpserts = 0;
  let failedUpserts = 0;

  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    console.log(` -> [Test] Upserting batch ${i / batchSize + 1} of ${Math.ceil(documents.length / batchSize)} (${batch.length} documents)...`);
    
    const recordsToUpsert = batch.map(doc => ({
      chunk_id: doc.chunk_id,
      product_id: doc.product_id,
      text_excerpt: doc.text_excerpt,
      embedding: doc.embedding,
      metadata: doc.metadata,
    }));

    try {
      const { error } = await supabase
        .from(supabaseTableName)
        .upsert(recordsToUpsert, { onConflict: 'chunk_id' });

      if (error) {
        console.error(`[Test] Error upserting batch to Supabase:`, error);
        failedUpserts += batch.length;
      } else {
        console.log(` -> [Test] Batch upserted successfully.`);
        successfulUpserts += batch.length;
      }
    } catch (e) {
        console.error('[Test] Exception during Supabase upsert:', e);
        failedUpserts += batch.length;
    }
  }
  console.log(`[Test] Finished Supabase upsert. Successful: ${successfulUpserts}, Failures: ${failedUpserts}`);
}

// --- Main Test Logic ---
async function testTranscriptUpload() {
  console.log('[Test] Starting transcript upload test...');
  const MAX_TRANSCRIPTS_TO_TEST = 3; // Configure how many transcripts to test
  let allSupabaseDocuments: SupabaseDocument[] = [];

  // 1. Load a sample of processed transcript data
  let processedTranscriptEntries: ProcessedTranscriptEntry[] = [];
  try {
    if (fs.existsSync(processedTranscriptsPath)) {
      const transcriptsJson = await fsPromises.readFile(processedTranscriptsPath, 'utf-8');
      const allEntries = JSON.parse(transcriptsJson) as ProcessedTranscriptEntry[];
      processedTranscriptEntries = allEntries.slice(0, MAX_TRANSCRIPTS_TO_TEST);
      console.log(` -> [Test] Loaded ${processedTranscriptEntries.length} (max ${MAX_TRANSCRIPTS_TO_TEST}) transcript entries for testing from ${processedTranscriptsPath}`);
      if (processedTranscriptEntries.length === 0 && allEntries.length > 0) {
        console.warn(` -> [Test] No transcript entries to test. Check MAX_TRANSCRIPTS_TO_TEST or the content of ${processedTranscriptsPath}`);
        return;
      }
       if (allEntries.length === 0) {
         console.warn(` -> [Test] The file ${processedTranscriptsPath} is empty or does not contain any transcript entries.`);
        return;
       }
    } else {
      console.log(` -> [Test] Processed transcripts file not found at ${processedTranscriptsPath}. Cannot run test.`);
      return;
    }
  } catch (error) {
    console.error(`[Test] Error loading or parsing ${processedTranscriptsPath}:`, error);
    return;
  }

  if (processedTranscriptEntries.length === 0) {
    console.log("[Test] No transcript entries to process. Exiting test.");
    return;
  }

  // 2. Chunking and generating embeddings for the sample
  console.log(`[Test] Chunking and generating embeddings for ${processedTranscriptEntries.length} transcript entries...`);
  let transcriptEmbeddingFailures = 0;
  let totalTranscriptDocumentsCreated = 0;

  for (let i = 0; i < processedTranscriptEntries.length; i++) {
    const entry = processedTranscriptEntries[i];
    if (!entry || !entry.airtable_transcript_record_id || typeof entry.transcript_text !== 'string') {
        console.warn(` -> [Test] Skipping invalid or incomplete transcript entry at index ${i}: `, entry);
        continue;
    }
    console.log(` -> [Test] Processing transcript entry ${i + 1}/${processedTranscriptEntries.length}, ID: ${entry.airtable_transcript_record_id}...`);

    const chunksData = await createTranscriptChunksForTesting(
      entry.transcript_text,
      entry.mentioned_products || [], // Ensure mentioned_products is an array
      entry.airtable_transcript_record_id
    );
    
    if (chunksData.length === 0) {
        console.warn(` -> [Test] No processable chunks for transcript ID: ${entry.airtable_transcript_record_id}. Skipping.`);
        continue;
    }
    console.log(`   -> [Test] Created ${chunksData.length} chunks for transcript ID: ${entry.airtable_transcript_record_id}. Generating embeddings...`);

    for (let c = 0; c < chunksData.length; c++) {
      const chunk = chunksData[c];
      const embeddingIdentifier = `[Test] Transcript ${chunk.metadata.airtable_transcript_record_id}, Chunk ${chunk.metadata.chunk_index + 1}/${chunk.metadata.total_chunks}`;
      console.log(`     -> [Test] [${i+1}/${processedTranscriptEntries.length}] Generating embedding for chunk ${c+1}/${chunksData.length}: ${embeddingIdentifier.substring(0, 100)}...`);
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
          console.warn(`     -> [Test] Embedding generation FAILED for: ${embeddingIdentifier}`);
      }
    }
    console.log(`   -> [Test] Finished embeddings for transcript ID: ${entry.airtable_transcript_record_id}. Total documents: ${totalTranscriptDocumentsCreated}. Failures: ${transcriptEmbeddingFailures}`);
  }
  console.log(`[Test] Finished transcript processing. Created ${totalTranscriptDocumentsCreated} transcript chunks/documents. Failures: ${transcriptEmbeddingFailures}`);

  // 3. Upsert to Supabase
  console.log(`\n[Test] Total documents prepared for Supabase: ${allSupabaseDocuments.length}`);
  if (allSupabaseDocuments.length === 0) {
      console.log("[Test] No documents to upsert to Supabase. Exiting test.");
      return;
  }
  
  await upsertDocumentsToSupabaseForTesting(allSupabaseDocuments);

  console.log('\n[Test] Transcript upload test completed.');
}

testTranscriptUpload().then(() => {
  console.log('[Test] Script finished successfully.');
}).catch(error => {
  console.error('[Test] Script failed:', error);
  process.exit(1);
}); 