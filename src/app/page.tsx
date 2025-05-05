'use client';

import { useChat, type Message } from 'ai/react';
import { useEffect, Fragment, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { ToolCard, ToolCardProps } from '@/components/tool-card';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Polyfill for findLastIndex if needed
if (!Array.prototype.findLastIndex) {
  Array.prototype.findLastIndex = function(predicate) {
    for (let i = this.length - 1; i >= 0; i--) {
      if (predicate(this[i], i, this)) {
        return i;
      }
    }
    return -1;
  };
}

function isToolCardProps(obj: any): obj is ToolCardProps {
  console.log('Checking if object is ToolCardProps:', obj);
  
  if (!obj || typeof obj !== 'object') {
    console.log('Not an object');
    return false;
  }
  
  // Check required string properties
  const requiredStringProps = ['id', 'name', 'nutshell'];
  for (const prop of requiredStringProps) {
    if (typeof obj[prop] !== 'string') {
      console.log(`Missing or invalid required string property: ${prop}`);
      return false;
    }
  }
  
  // Check logo_url and website properties (allow missing values for flexibility)
  const optionalStringProps = ['logo_url', 'website'];
  for (const prop of optionalStringProps) {
    if (obj[prop] !== undefined && typeof obj[prop] !== 'string') {
      console.log(`Invalid optional string property: ${prop}`);
      return false;
    }
  }
  
  // Check features array (allow empty array)
  if (obj.features !== undefined && !Array.isArray(obj.features)) {
    console.log('features is not an array');
    return false;
  }
  
  // Check screenshot_urls array (allow empty array)
  if (obj.screenshot_urls !== undefined && !Array.isArray(obj.screenshot_urls)) {
    console.log('screenshot_urls is not an array');
    return false;
  }
  
  // Check number properties (be more flexible)
  const numberProps = ['influencer_count', 'reddit_sentiment_raw'];
  for (const prop of numberProps) {
    if (obj[prop] !== undefined && typeof obj[prop] !== 'number') {
      console.log(`Invalid number property: ${prop}`);
      // But don't reject the whole object for these
    }
  }
  
  // affiliate_link can be string or null or undefined
  if (obj.affiliate_link !== null && obj.affiliate_link !== undefined && typeof obj.affiliate_link !== 'string') {
    console.log('affiliate_link is not string or null');
    // Don't reject for this
  }
  
  // If we have the core properties, consider it a valid card
  return true;
}

// --- Child Component for Rendering Cards --- 
interface ToolCardListProps {
  cards: ToolCardProps[];
}

function ToolCardList({ cards }: ToolCardListProps) {
  console.log("Rendering ToolCardList with cards:", cards);
  if (!cards || cards.length === 0) return null;

  return (
    <div className="mt-4 space-y-3 pt-3 border-t border-green-200 w-full"> 
      <h4 className="text-sm font-semibold text-gray-700">Recommended Tools:</h4>
      {cards.map((toolData, index) => {
        // Check if we have a valid ID, otherwise use index
        const key = toolData.id || `tool-${index}`;
        console.log(`Rendering card ${index}: ${toolData.name}`);
        
        try {
          return (
            <ToolCard 
              key={key} 
              {...toolData}      
            />
          );
        } catch (error) {
          console.error("Error rendering tool card:", error);
          // Fallback simple card rendering if ToolCard component fails
          return (
            <div key={key} className="p-3 border rounded-lg shadow-sm">
              <h3 className="font-medium">{toolData.name || 'Unknown Tool'}</h3>
              <p className="text-sm text-gray-600">{toolData.nutshell || 'No description available'}</p>
            </div>
          );
        }
      })}
    </div>
  );
}

// Extend the Message type to include cards
interface MessageWithCards extends Message {
  cards?: ToolCardProps[];
}

// --- Main Chat Component --- 
export default function Chat() {
  // Track enhanced messages with their associated cards
  const [messagesWithCards, setMessagesWithCards] = useState<MessageWithCards[]>([]);
  // Track card data by message ID for more reliable mapping
  const [cardsByMessageId, setCardsByMessageId] = useState<Record<string, ToolCardProps[]>>({});
  // Track which data arrays we've already processed
  const [processedDataLength, setProcessedDataLength] = useState<number>(0);
  
  const { 
    messages, 
    input, 
    handleInputChange, 
    handleSubmit,
    error, 
    isLoading, 
    data
  } = useChat();

  // Debug function
  const debugState = () => {
    console.log('---DEBUG STATE---');
    console.log('Messages:', messages);
    console.log('MessagesWithCards:', messagesWithCards);
    console.log('CardsByMessageId:', cardsByMessageId);
    console.log('Data:', data);
    console.log('ProcessedDataLength:', processedDataLength);
    console.log('----------------');
  };

  // Process data and update card mapping when new data arrives
  useEffect(() => {
    if (!Array.isArray(data) || !messages.length) return;
    
    console.log('=== PROCESSING NEW DATA ===');
    console.log('Messages count:', messages.length);
    console.log('Data arrays count:', data.length);
    console.log('Previously processed data length:', processedDataLength);
    
    // If we've already processed all the current data entries, don't re-process
    if (data.length <= processedDataLength) {
      console.log(`No new data to process (current: ${data.length}, processed: ${processedDataLength})`);
      return;
    }
    
    // Debug all available data to help diagnose issues
    console.log(`Processing new data entries: ${processedDataLength} to ${data.length - 1}`);
    console.log('Processing data array:', data.slice(processedDataLength));
    
    let toolCards: ToolCardProps[] = [];
    let hasCards = false;
    let dataIndexWithCards = -1;
    
    // Only check new data entries that we haven't processed yet
    for (let i = processedDataLength; i < data.length; i++) {
      const dataItem = data[i];
      console.log(`Examining data[${i}]:`, dataItem);
      
      if (Array.isArray(dataItem) && dataItem.length > 0) {
        console.log(`Data[${i}] is an array with ${dataItem.length} items`);
        // Type guard to ensure we're working with an array of objects
        const objectArray = dataItem.filter(item => item && typeof item === 'object');
        console.log(`Data[${i}] has ${objectArray.length} valid objects`);
        
        if (objectArray.length > 0) {
          const filteredData = objectArray.filter(isToolCardProps);
          console.log(`Data[${i}] has ${filteredData.length} valid tool cards`);
          
          if (filteredData.length > 0) {
            toolCards = filteredData as unknown as ToolCardProps[];
            console.log(`Found ${toolCards.length} cards in data[${i}]`, toolCards);
            hasCards = true;
            dataIndexWithCards = i;
            break;
          }
        }
      }
    }

    // Update the processed data length to avoid reprocessing
    console.log(`Updating processedDataLength from ${processedDataLength} to ${data.length}`);
    setProcessedDataLength(data.length);

    // Only process if we have cards and messages
    if (hasCards && toolCards.length > 0) {
      console.log('Cards found! Looking for suitable message to attach them to');
      
      // CRITICAL CHANGE: Find the NEWEST message that has strong recommendation indicators
      // Get all assistant messages in reverse order (newest first)
      const assistantMessages = [...messages]
        .filter(m => m.role === 'assistant')
        .sort((a, b) => {
          const timeA = new Date(a.createdAt || 0).getTime();
          const timeB = new Date(b.createdAt || 0).getTime();
          return timeB - timeA; // Newest first
        });
      
      console.log('Assistant messages (newest first):', assistantMessages.map(m => m.id));
      
      // Strong recommendation patterns that indicate a message should have cards
      const strongRecommendationPatterns = [
        "below",
        "you'll find",
        "selection of tools",
        "recommended tools",
        "tools designed",
        "can help you with"
      ];
      
      // First try to find messages with strong recommendation indicators
      let targetMessage = null;
      for (const message of assistantMessages) {
        const content = message.content || '';
        
        // Check for strong recommendation patterns
        const hasStrongRecommendation = strongRecommendationPatterns.some(pattern => 
          content.toLowerCase().includes(pattern.toLowerCase())
        );
        
        if (hasStrongRecommendation) {
          console.log(`Found message with strong recommendation indicators: ${message.id}`);
          targetMessage = message;
          break;
        }
      }
      
      // If no message with strong indicators, fall back to most recent assistant message
      if (!targetMessage && assistantMessages.length > 0) {
        targetMessage = assistantMessages[0]; // Most recent assistant message
        console.log(`No message with strong indicators, using most recent: ${targetMessage.id}`);
      }
      
      if (targetMessage) {
        console.log(`Associating cards with message ID: ${targetMessage.id}`);
        
        // Clear any previous card assignments
        setCardsByMessageId(prev => {
          // Create a new card mapping with just this message's cards
          const newMapping: Record<string, ToolCardProps[]> = {};
          newMapping[targetMessage!.id] = toolCards;
          return newMapping;
        });
      } else {
        console.log('No suitable message found for cards');
      }
    }
    
    console.log('=== END PROCESSING NEW DATA ===');
  }, [data, messages, processedDataLength]);

  // Create messagesWithCards from messages and cardsByMessageId
  useEffect(() => {
    console.log('=== PROCESSING MESSAGES ===');
    console.log('Original messages:', messages);
    
    // Sort messages by timestamp to enforce chronological order
    const sortedMessages = [...messages].sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      console.log(`Comparing: ${a.role} (${a.id}) at ${timeA} vs ${b.role} (${b.id}) at ${timeB}`);
      return timeA - timeB;
    });
    
    console.log('Sorted messages:', sortedMessages);
    
    // If we don't have cards assigned yet but data has cards, try to match them with the latest message
    if (Object.keys(cardsByMessageId).length === 0 && Array.isArray(data) && data.length > 0) {
      console.log('No cards assigned yet, checking if we need to initialize card mapping');
      
      // Find the latest assistant message
      const lastAssistantIndex = sortedMessages.findLastIndex(m => m.role === 'assistant');
      if (lastAssistantIndex >= 0) {
        const assistantMessage = sortedMessages[lastAssistantIndex];
        console.log('Checking if last assistant message should have cards:', assistantMessage.id);
        
        let foundCards: ToolCardProps[] = [];
        
        // Look for card data
        for (let i = 0; i < data.length; i++) {
          const dataItem = data[i];
          if (Array.isArray(dataItem) && dataItem.length > 0) {
            const objectArray = dataItem.filter(item => item && typeof item === 'object');
            if (objectArray.length > 0) {
              const filteredData = objectArray.filter(isToolCardProps);
              if (filteredData.length > 0) {
                foundCards = filteredData as unknown as ToolCardProps[];
                console.log(`Found ${foundCards.length} cards in data[${i}] to initialize with`);
                break;
              }
            }
          }
        }
        
        if (foundCards.length > 0) {
          console.log(`Initializing card mapping with ${foundCards.length} cards for message:`, assistantMessage.id);
          // Update card mapping
          setCardsByMessageId(prev => ({
            ...prev,
            [assistantMessage.id]: foundCards
          }));
          // Don't proceed with rest of this effect run - will re-run with updated mapping
          return;
        }
      }
    }
    
    const enhanced = sortedMessages.map(message => {
      // Get cards for this message if they exist
      const cards = message.id ? cardsByMessageId[message.id] : undefined;
      console.log(`Enhancing message ${message.id} (${message.role}):`, cards ? `with ${cards.length} cards` : 'no cards');
      
      // Return the enhanced message
      return {
        ...message,
        cards
      };
    });
    
    console.log('Enhanced messages with cards:', enhanced);
    setMessagesWithCards(enhanced);
    
    // Debug current card mapping
    console.log('Current cardsByMessageId:', cardsByMessageId);
    console.log('=== END PROCESSING MESSAGES ===');
  }, [messages, cardsByMessageId, data]);

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSubmit(event);
  };

  return (
    <div className="flex flex-col w-full min-h-screen px-4 py-12">
      <div className="flex-grow overflow-y-auto mb-4 bg-gray-100 rounded p-4 w-full max-w-4xl mx-auto">
        <div className="debug-info bg-yellow-100 p-2 text-xs mb-4 rounded" style={{display: 'block'}}>
          <div>Total Messages: {messagesWithCards.length}</div>
          <div>Cards by Message: {
            Object.entries(cardsByMessageId).map(([msgId, cards]) => 
              `${msgId}: ${cards.length} cards`
            ).join(', ')
          }</div>
          <div><pre>Ordered IDs: {JSON.stringify(messagesWithCards.map(m => m.id), null, 2)}</pre></div>
        </div>
        
        {messagesWithCards.length > 0
          ? (
              <div className="flex flex-col space-y-6">
                {messagesWithCards.map((m, index) => {
                  console.log(`=== RENDERING MESSAGE ${index} ===`);
                  console.log(`Message ${index}: ${m.id} (${m.role}) at ${m.createdAt}`);
                  console.log(`Message ${index} has cards:`, m.cards ? `${m.cards.length} cards` : 'no cards');
                  
                  // Create a unique order index for strict order enforcement
                  const orderIndex = index * 2;
                  
                  return (
                    // Each message and its cards are wrapped in a single container div
                    <div 
                      key={m.id} 
                      className="message-container flex flex-col w-full" 
                      style={{
                        border: '1px dashed #ccc', 
                        padding: '8px', 
                        marginBottom: '16px',
                        position: 'relative',
                        order: orderIndex
                      }}
                      data-message-order={orderIndex}
                    >
                      <div className="debug-label" style={{
                        position: 'absolute',
                        top: '-12px',
                        left: '10px',
                        backgroundColor: '#f0f0f0',
                        fontSize: '10px',
                        padding: '2px 4px',
                        border: '1px solid #ccc',
                        borderRadius: '4px'
                      }}>
                        Message {index}: {m.id} ({m.role}) [order: {orderIndex}]
                      </div>
                      
                      {/* The actual message bubble */}
                      <div 
                        className={`whitespace-pre-wrap p-3 rounded-lg shadow-sm ${
                          m.role === 'user' 
                            ? 'bg-blue-100 text-blue-900 text-left ml-auto max-w-[80%]' 
                            : 'bg-green-100 text-green-900 text-left mr-auto max-w-[80%]'
                        }`}
                        data-message-id={m.id}
                        data-message-role={m.role}
                        data-message-index={index}
                      >
                        <b className="block mb-1">{m.role === 'user' ? 'User:' : 'AI:'}</b>
                        {m.role === 'assistant' ? (
                          <div className="prose prose-sm max-w-none">
                            <ReactMarkdown>{m.content}</ReactMarkdown> 
                          </div>
                        ) : (
                          <span>{m.content}</span>
                        )}
                      </div>
                      
                      {/* Cards are rendered immediately after the message to maintain chronological order */}
                      {m.role === 'assistant' && m.cards && m.cards.length > 0 && (
                        <div 
                          className="mr-auto ml-0 max-w-[95%] mt-3 card-container"
                          data-cards-for-message={m.id}
                          data-cards-count={m.cards.length}
                        >
                          <div className="debug-card-info bg-blue-50 text-xs p-1 mb-2">
                            {m.cards.length} cards for message {m.id}
                          </div>
                          <ToolCardList cards={m.cards} />
                        </div>
                      )}
                      <div style={{clear: 'both'}}></div>
                    </div>
                  );
                })}
              </div>
            )
          : (
            <div className="text-center text-gray-500">Send a message to start the chat!</div>
          )
        }
        {isLoading && <div className="text-center text-gray-400 italic">AI thinking...</div>}
      </div>

      <div className="max-w-2xl w-full mx-auto">
          <form onSubmit={handleFormSubmit} className="flex items-center space-x-2">
            <Input
              className="flex-grow"
              value={input}
              placeholder="Ask about SaaS tools..."
              onChange={handleInputChange}
              disabled={isLoading}
            />
            <Button 
              type="submit" 
              disabled={isLoading}
            >
              Send
            </Button>
          </form>
          {error && <div className="mt-2 text-red-500 text-sm">Error: {error.message}</div>}
          
          {/* Debug button - only visible in development */}
          {process.env.NODE_ENV === 'development' && (
            <Button 
              onClick={debugState}
              variant="outline"
              size="sm"
              className="mt-4"
            >
              Debug in Console
            </Button>
          )}
      </div>
    </div>
  );
}
