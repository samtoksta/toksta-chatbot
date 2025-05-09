import { CoreMessage, StreamingTextResponse, OpenAIStream, StreamData } from 'ai';
import { NextRequest } from 'next/server';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { cosineSimilarity } from '@/lib/utils';
import { supabase } from '@/lib/supabaseClient';
import productsData from '@/../tools_vectors.json';
import { Message } from '@ai-sdk/react'; // For incoming message type

// IMPORTANT! Set the runtime to edge
export const runtime = 'edge';

// --- Configuration ---
const openAIApiKey = process.env.OPENAI_API_KEY;
const embeddingModel = 'text-embedding-3-small';
const chatModel = 'gpt-4.1-mini-2025-04-14'
const topK = 5; // How many products to initially match
const transcriptMatchThreshold = 0.5;
const transcriptMatchCount = 3; // Max chunks per product
const fallbackThreshold = 0.4; // Threshold to trigger fallback search

if (!openAIApiKey) {
  throw new Error('Missing environment variable: OPENAI_API_KEY');
}

// Only need the standard OpenAI client
const openai = new OpenAI({ apiKey: openAIApiKey });

// --- Types ---
interface ProductFactWithEmbedding {
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
  embedding: number[];
}

interface TranscriptChunk {
  chunk_id: string;
  product_id: string;
  text_excerpt: string;
  similarity: number;
}

const products: ProductFactWithEmbedding[] = productsData as ProductFactWithEmbedding[];

const FINAL_ANSWER_PREFIX = 'FINAL_ANSWER:';

// Define intent flags
const INTENT_CLARIFY = 'INTENT: CLARIFY';
const INTENT_RECOMMEND = 'INTENT: RECOMMEND';

// Helper to prepare card data
function prepareCardData(productContext: ProductFactWithEmbedding[]) {
  return productContext.map(p => ({
    id: p.id,
    name: p.name,
    nutshell: p.nutshell,
    features: p.features,
    influencer_count: p.influencer_count,
    reddit_sentiment_raw: p.reddit_sentiment_raw,
    logo_url: p.logo_url,
    screenshot_urls: p.screenshot_urls,
    affiliate_link: p.affiliate_link,
    website: p.website,
    subcategory_list: p.subcategory_list
  }));
}

// --- Main Request Handler ---
export async function POST(req: NextRequest) {
  try {
    // Reverted: Read the isFollowUp flag and recommendedToolIds from the request body
    const { messages, isFollowUp, recommendedToolIds }: { 
      messages: CoreMessage[]; // messages is required again
      isFollowUp?: boolean; 
      recommendedToolIds?: string[];
    } = await req.json();
    
    // Reverted: data initialization moved back into the non-follow-up branch or handled as needed

    // Reverted: Removed Initial Greeting Handling Block

    // Reverted: messages validation
    if (!messages || messages.length === 0) return new Response('Missing messages', { status: 400 });
    const lastMessage = messages[messages.length - 1];
    if (typeof lastMessage.content !== 'string') return new Response('Last message content invalid', { status: 400 });
    const userQuery = lastMessage.content;

    console.log('User query for this turn:', userQuery);
    console.log('Is Follow Up Mode:', isFollowUp); // Log the follow-up mode
    if (recommendedToolIds && recommendedToolIds.length > 0) {
      console.log('Recommended Tool IDs for follow-up:', recommendedToolIds);
    }

    // Count how many assistant messages are clarification questions
    // This helps us enforce the "at least 5 questions" rule
    const assistantMessageCount = messages.filter(m => m.role === 'assistant').length;
    console.log(`Current assistant message count: ${assistantMessageCount}`);
    
    const data = new StreamData(); // data initialized here again for the original logic path
    let streamSource = 'unknown'; // Track the stream source for logging

    // --- Conditional Logic based on isFollowUp ---
    if (isFollowUp) {
      // --- FOLLOW-UP LOGIC --- 
      console.log('Handling as a follow-up question.');
      streamSource = 'follow_up_response';

      let followUpSystemPrompt = "You are an AI assistant helping users find the perfect SaaS for their particular needs. Answer the user's follow-up question based on the conversation history.";
      
      // Check if specific tool IDs were provided for context
      if (recommendedToolIds && recommendedToolIds.length > 0) {
          console.log('Contextualizing follow-up for specific tools:', recommendedToolIds);
          // Find the tool details from the main products list
          const relevantTools = products.filter(p => recommendedToolIds.includes(p.id));
          
          if (relevantTools.length > 0) {
              const toolNames = relevantTools.map(t => t.name).join(', ');
              followUpSystemPrompt = `You are an AI assistant helping users find the perfect SaaS for their particular needs. The user previously saw recommendations for: ${toolNames}. Their follow-up question relates ONLY to these tools. Answer the question based *only* on these tools (${toolNames}) and the conversation history. Do not mention or compare any other tools.`;
              console.log('Updated follow-up prompt for context:', followUpSystemPrompt);
          } else {
              console.warn('Follow-up requested for tool IDs, but no matching tools found in data.');
          }
      } else {
        console.log('No specific tool IDs provided for follow-up, using generic prompt.');
      }

      // Prepare messages for standard LLM generation (history + new question)
      const followUpMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: followUpSystemPrompt },
        ...messages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content as string }))
      ];

      // Call LLM to generate the stream directly
      const response = await openai.chat.completions.create({
        model: chatModel,
        messages: followUpMessages,
        temperature: 0.7,
        stream: true,
      }).asResponse();

      const stream = OpenAIStream(response);
      // Append empty card data for follow-up
      data.append([]); 
      data.close();
      console.log('Appended empty card data for follow-up stream.');
      
      return new StreamingTextResponse(stream, {}, data);

    } else {
      // --- ORIGINAL LOGIC (NEW QUERY or CLARIFICATION) --- 
      console.log('Handling as a new query or clarification. Proceeding with intent check.');
      
      // 1. Prepare messages for LLM intent check
      const systemPrompt = `You are an AI assistant helping to match users with the perfect SaaS tool for their needs. 
      Your goal is to first understand the user's needs through clarification on specific features they need, 
      then provide a brief text leading into tool recommendation cards.

**Conversation Flow:**
1. Analyze the user's latest message and the conversation history.
2. Count how many clarification questions you have already asked in this conversation.
3. **IMPORTANT: You MUST ask at least 10 clarifying questions before making recommendations, but ask ONLY ONE QUESTION AT A TIME.**
4. **If you have asked 10 or more clarifying questions AND have enough information:**
Generate the final introductory text (confirming tool type, explaining purpose, directing to cards on the right hand side).
Do NOT list specific tool names. Then, on a new line at the very end, append exactly:
${INTENT_RECOMMEND}
5. **Otherwise (need more clarification):** Ask ONLY ONE specific clarifying question (total of at least 10 required).
Present a list of suggested options (aim for at least 5) as potential answers.
**Crucially, each option's text should be self-contained, directly incorporate the core subject of your question, AND BE OPTIMIZED FOR VECTOR SEARCH.**
**This means focusing on nouns, key features, specific requirements, or concise descriptors rather than full conversational sentences or evaluative phrases like "is important" or "I need". The goal is to extract keywords and specific attributes.**
**When a user indicates they *don't* need a feature (a negative preference), the suggested answer should ideally reframe this as a positive preference for an alternative, or a neutral statement that avoids strongly featuring the undesired keywords in a way that would attract them during a search. The aim is to prevent the vector search from being misled by the presence of keywords for features the user explicitly *rejects*.**
For example, if you ask "How important is real-time collaboration for your team?",
suggested answers for *wanting* it could be "Advanced real-time collaboration", "Basic real-time collaboration".
Suggested answers for *not* wanting it could be "Focus on asynchronous communication", "Individual task workflow preferred", or "Real-time collaboration: Not a priority" rather than "No real-time collaboration features".
Other neutral options: "Collaboration features: No preference".
This ensures the user's selection provides clear, keyword-rich context for vector search, or clearly indicates an exclusion.
If offering an "all of the features mentioned" type option, ensure it clearly references the features from *your current question and suggested answers* in a keyword-focused way.
Then, on a new line at the very end, append exactly:
${INTENT_CLARIFY}

**IMPORTANT:**
- NEVER ask multiple questions at once. ONLY ask ONE question at a time.
- Each response should contain only a single follow-up question.
- Always append either ${INTENT_RECOMMEND} or ${INTENT_CLARIFY} on a new line as the absolute last part of your response.
- When asking clarification questions, *always* include answer suggestions by putting them in a list format starting with "SUGGESTED_ANSWERS:" at the end of your response, just before the intent flag. For example:

SUGGESTED_ANSWERS:
- Feature A: Specific aspect
- Alternative B: If not Feature A
- Requirement C: Level
- Focus on: Different approach
- Feature X: Not a priority

${INTENT_CLARIFY}`;

      // Add information about the current question count to force the model to follow the rule
      const intentCheckMessages: ChatCompletionMessageParam[] = [
        { 
          role: 'system', 
          content: systemPrompt + `\n\nYou have asked ${assistantMessageCount} clarifying questions so far. Remember, you MUST ask at least 5 questions total before recommending tools.`
        },
        ...messages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({ role: msg.role as 'user' | 'assistant', content: msg.content as string }))
      ];

      // 2. Call LLM non-streaming for intent
      console.log('Calling LLM to get response and intent...');
      let fullLlmResponse = '';
      try {
        const response = await openai.chat.completions.create({
          model: chatModel,
          messages: intentCheckMessages,
          temperature: 0.7,
          stream: false,
        });
        fullLlmResponse = response.choices?.[0]?.message?.content?.trim() || '';
        console.log('LLM Raw Response:', fullLlmResponse);
      } catch (llmError) {
        console.error("LLM intent call failed:", llmError);
        const message = llmError instanceof Error ? llmError.message : String(llmError);
        throw new Error(`Failed to get intent from AI: ${message}`);
      }

      // 3. Parse response and intent
      let intent = INTENT_CLARIFY;
      let mainResponseText = fullLlmResponse;
      const lines = fullLlmResponse.split('\n');
      const lastLine = lines.length > 0 ? lines[lines.length - 1].trim() : '';
      if (lastLine.endsWith(INTENT_RECOMMEND)) {
          // Check if we have enough clarification questions
          if (assistantMessageCount >= 4) { // ≥4 means this will be the 5th or higher interaction
            intent = INTENT_RECOMMEND;
            console.log(`Allowing recommendation after ${assistantMessageCount} assistant messages`);
          } else {
            // Override the intent - force more clarification
            intent = INTENT_CLARIFY;
            console.log(`Overriding intent to CLARIFY - only ${assistantMessageCount} assistant messages so far, need at least 5`);
          }
          const flagIndex = fullLlmResponse.lastIndexOf(INTENT_RECOMMEND);
          mainResponseText = fullLlmResponse.substring(0, flagIndex).trim();
      } else if (lastLine.endsWith(INTENT_CLARIFY)) {
          intent = INTENT_CLARIFY;
          const flagIndex = fullLlmResponse.lastIndexOf(INTENT_CLARIFY);
          mainResponseText = fullLlmResponse.substring(0, flagIndex).trim();
      } else {
          console.warn("LLM response did not end with a recognized intent flag. Treating as clarification.");
      }
      console.log(`Parsed Intent: ${intent}`);
      console.log(`Main Response Text: ${mainResponseText}`);

      // --- Streaming Logic using Vercel AI SDK --- 
      // Initialize llmStreamMessages to avoid use-before-assign error
      let llmStreamMessages: ChatCompletionMessageParam[] = []; 
      let streamSource = 'clarification'; // Default stream source
      let textForEmbedding = mainResponseText; // Initialize with the LLM's textual response

      if (intent === INTENT_RECOMMEND) {
        // Attempt to reconstruct a better query for embedding if user selected a generic option
        const lastUserMessage = messages[messages.length - 1];
        const lastUserQuery = typeof lastUserMessage?.content === 'string' ? lastUserMessage.content.toLowerCase() : "";

        const genericCatchAllPhrases = [
            "all of the features mentioned",
            "all of the above",
            "all features",
            "all of them",
            "yes, all of those"
        ];

        const userChoseGenericCatchAll = genericCatchAllPhrases.some(phrase => 
            lastUserQuery.includes(phrase.toLowerCase())
        );

        if (userChoseGenericCatchAll && messages.length >= 2) {
            const previousAssistantMessage = messages[messages.length - 2];
            if (previousAssistantMessage?.role === 'assistant' && typeof previousAssistantMessage.content === 'string') {
                const assistantResponseText = previousAssistantMessage.content;
                const suggestedAnswersMarker = "SUGGESTED_ANSWERS:";
                const markerIndex = assistantResponseText.indexOf(suggestedAnswersMarker);

                if (markerIndex !== -1) {
                    const suggestionsBlock = assistantResponseText.substring(markerIndex + suggestedAnswersMarker.length);
                    const featureLines = suggestionsBlock.split('\n')
                        .map(line => line.trim())
                        .filter(line => line.startsWith('- '))
                        .map(line => line.substring(2).trim());

                    const concreteFeatures = featureLines.filter(feature => 
                        feature.length > 0 && 
                        !genericCatchAllPhrases.some(phrase => feature.toLowerCase() === phrase.toLowerCase())
                    );

                    if (concreteFeatures.length > 0) {
                        textForEmbedding = concreteFeatures.join('. '); 
                        console.log(`Reconstructed query for embedding from previous suggestions: "${textForEmbedding}"`);
                    } else {
                        console.warn("User chose a generic catch-all, but no concrete features extracted. Using LLM's current response for embedding.");
                    }
                } else {
                     console.warn("User chose a generic catch-all, but 'SUGGESTED_ANSWERS:' marker not found. Using LLM's current response for embedding.");
                }
            } else {
                console.warn("User chose a generic catch-all, but previous message was not suitable. Using LLM's current response for embedding.");
            }
        } else if (intent === INTENT_RECOMMEND) {
            // If not a generic response, mainResponseText (AI's summary) is used.
             console.log(`Using LLM's main response text for embedding: "${mainResponseText}"`);
        }
        // textForEmbedding is now set

        // 4a. Generate embedding (using standard openai client)
        console.log(`Generating embedding based on: "${textForEmbedding}"`); // Use the refined text
        const queryEmbeddingResponse = await openai.embeddings.create({
            model: embeddingModel,
            input: textForEmbedding.replace(/\n/g, ' '), // Use textForEmbedding
            dimensions: 1536,
        });
        const queryEmbedding = queryEmbeddingResponse.data[0].embedding;
        // 4b. Perform search (logic unchanged)
        const similarities = products.map(product => ({ score: cosineSimilarity(queryEmbedding, product.embedding), product }));
        similarities.sort((a, b) => b.score - a.score);
        const qualifiedProducts = similarities.filter(sim => sim.score >= fallbackThreshold);
        const topProductsAboveThreshold = qualifiedProducts.slice(0, topK);
        const productContext = topProductsAboveThreshold.map(p => p.product);
        console.log(`Search complete: Found ${productContext.length} products.`);

        if (productContext.length === 0) {
          // 4c-FALLBACK: No products found, stream LLM knowledge
          streamSource = 'fallback_knowledge';
          console.log('Search found 0 products. Falling back to LLM knowledge generation.');
          const fallbackSystemPrompt = `Our database search found no tools matching the user's request. Please provide some general recommendations based solely on your internal knowledge. Do not mention the database search.`;
          llmStreamMessages = [
            { role: 'system', content: fallbackSystemPrompt },
            { role: 'user', content: mainResponseText } 
          ];
          // Append empty card data for fallback
          data.append([]); 
          console.log('Appended empty card data for fallback stream.');
        } else {
          // 4c-NORMAL: Products found, stream cards and static intro text
          streamSource = 'recommendation_with_cards';
          console.log('Products found. Preparing cards and static intro text.');
          const cardData = prepareCardData(productContext);
          data.append(cardData);
          console.log(`Appended ${cardData.length} cards to data stream.`);
        }
      } else {
        // 5. INTENT_CLARIFY: Stream only the clarification text
        streamSource = 'clarification_only';
        console.log('Treating as clarification question. Streaming only text.');
        // Append empty card data for clarification
        data.append([]);
        console.log('Appended empty card data for clarification stream.');
      }

      // Ensure stream data is closed so it is included in the response
      data.close();

      // 6. Create and return the stream
      console.log(`Creating stream from source: ${streamSource}`);

      // If recommending with cards, create a simple stream for the static text
      if (streamSource === 'recommendation_with_cards') {
        const staticIntroText = mainResponseText || "Here are the tools that match your request:"; 
        // Format the static text using the SDK's simple text protocol (0:"<text>")
        const formattedTextChunk = `0:${JSON.stringify(staticIntroText)}\n`; 
        const readableStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(formattedTextChunk));
                controller.close();
            }
        });
        // Return the static text stream combined with the card data
        return new StreamingTextResponse(readableStream, {}, data);
      } else if (streamSource === 'clarification_only') {
        // For clarification, create a static stream with the assistant's message
        // Format the text using the SDK's simple text protocol (0:"<text>")
        const formattedTextChunk = `0:${JSON.stringify(mainResponseText)}\n`;
        const readableStream = new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode(formattedTextChunk));
                controller.close();
            }
        });
        return new StreamingTextResponse(readableStream, {}, data);
      } else {
        // Otherwise (fallback knowledge), call the LLM to generate the stream
        const response = await openai.chat.completions.create({
          model: chatModel,
          messages: llmStreamMessages, // Use messages prepared earlier
          temperature: 0.7,
          stream: true,
        }).asResponse();
        const stream = OpenAIStream(response);
        return new StreamingTextResponse(stream, {}, data);
      }
    }
    // --- End of Conditional Logic --- 

  } catch (error) {
    console.error("[POST Handler Error]:", error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
    return new Response(JSON.stringify({ error: errorMessage }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}