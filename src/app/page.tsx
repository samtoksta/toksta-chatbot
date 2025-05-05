'use client';

import React from 'react';
import { useChat, type Message } from 'ai/react';
import { useEffect, useState, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { ToolCard, ToolCardProps } from '@/components/tool-card';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function isToolCardProps(obj: any): obj is ToolCardProps {
  if (!obj || typeof obj !== 'object') return false;
  
  // Check required properties
  const requiredStringProps = ['id', 'name', 'nutshell'];
  for (const prop of requiredStringProps) {
    if (typeof obj[prop] !== 'string') return false;
  }
  
  return true;
}

// Function to detect tool references in user messages
function detectToolReferences(message: string, recommendedTools: ToolCardProps[]): string[] {
  return recommendedTools
    .filter(tool => message.toLowerCase().includes(tool.name.toLowerCase()))
    .map(tool => tool.id);
}

// Tool Card List Component
interface ToolCardListProps {
  cards: ToolCardProps[];
}

function ToolCardList({ cards }: ToolCardListProps) {
  if (!cards || cards.length === 0) return null;

  return (
    <div className="mt-4 space-y-3 pt-3 border-t border-green-200 w-full"> 
      <h4 className="text-sm font-semibold text-gray-700">Recommended Tools:</h4>
      {cards.map((toolData, index) => {
        const key = toolData.id || `tool-${index}`;
        
        try {
          return <ToolCard key={key} {...toolData} />;
        } catch (error) {
          // Fallback rendering if component fails
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

interface MessageWithCards extends Message {
  cards?: ToolCardProps[] | undefined;
}

// New: ChatMessages Component
interface ChatMessagesProps {
  messages: MessageWithCards[];
  isLoading: boolean;
  onSetFollowUpMode: (isFollowUp: boolean) => void;
  onSubmitSuggestion: (text: string) => void;
}

// New helper function to extract suggested answers from response
function extractSuggestedAnswers(message: string): string[] {
  if (!message.includes('SUGGESTED_ANSWERS:')) return [];
  
  try {
    const suggestedAnswersSection = message.split('SUGGESTED_ANSWERS:')[1].split(/\n\n/)[0];
    return suggestedAnswersSection
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('- '))
      .map(line => line.substring(2).trim())
      .filter(answer => answer.length > 0);
  } catch (error) {
    console.error('Error extracting suggested answers:', error);
    return [];
  }
}

// Function to programmatically submit a message
const SuggestedAnswers = ({ answers, onSelectAnswer }: { answers: string[], onSelectAnswer: (answer: string) => void }) => {
  if (answers.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 my-2">
      {answers.map((answer, index) => (
        <Button 
          key={index} 
          variant="outline" 
          size="sm"
          onClick={() => onSelectAnswer(answer)}
          className="text-xs"
        >
          {answer}
        </Button>
      ))}
    </div>
  );
};

function ChatMessages({ messages, isLoading, onSetFollowUpMode, onSubmitSuggestion }: ChatMessagesProps) {
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom effect
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  // Check if any message has cards (recommendations)
  const hasRecommendations = messages.some(m => m.cards && m.cards.length > 0);

  return (
    <div 
      ref={chatContainerRef}
      className="flex-grow overflow-y-auto p-4 w-full chat-container"
      style={{ maxHeight: 'calc(100vh - 150px)' }}
    >
      {messages.length > 0 ? (
        <div className="flex flex-col space-y-6">
          {messages.map((m, index) => {
            const isLastAssistantMessage = 
              m.role === 'assistant' && 
              index === messages.length - 1;
              
            const shouldShowFollowUpButtons = 
              isLastAssistantMessage && 
              m.cards && 
              m.cards.length > 0; // Only show when there are tool recommendations
              
            // Extract suggested answers if this is the last assistant message
            let suggestedAnswers: string[] = [];
            let cleanedContent = m.content;
            
            if (m.role === 'assistant') {
              suggestedAnswers = extractSuggestedAnswers(m.content);
              
              // Remove the SUGGESTED_ANSWERS section from displayed content
              if (suggestedAnswers.length > 0) {
                cleanedContent = m.content.split('SUGGESTED_ANSWERS:')[0].trim();
              }
            }
            
            const shouldShowSuggestedAnswers = isLastAssistantMessage && suggestedAnswers.length > 0;

            return (
              <div
                key={m.id}
                className="message-container flex flex-col w-full"
              >
                {/* Message Bubble */}
                <div
                  className={`whitespace-pre-wrap p-4 rounded-lg shadow-sm ${
                    m.role === 'user'
                      ? 'bg-blue-100 text-blue-900 self-end max-w-[85%]'
                      : 'bg-white border border-gray-200 text-gray-900 self-start max-w-[85%]'
                  }`}
                >
                  {m.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{cleanedContent}</ReactMarkdown>
                    </div>
                  ) : (
                    <span>{m.content}</span>
                  )}
                </div>

                {/* Suggested Answer Buttons */}
                {shouldShowSuggestedAnswers && (
                  <div className="flex flex-wrap gap-2 mt-4 pl-2">
                    {suggestedAnswers.map((answer, i) => (
                      <Button 
                        key={`suggested-${i}`}
                        variant="outline"
                        size="sm"
                        className="text-left"
                        onClick={() => {
                          onSubmitSuggestion(answer);
                        }}
                      >
                        {answer}
                      </Button>
                    ))}
                  </div>
                )}

                {/* Follow-up Buttons - Only show when there are tool recommendations */}
                {shouldShowFollowUpButtons && (
                  <div className="flex justify-start space-x-2 mt-3 pl-2">
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={() => onSetFollowUpMode(true)}
                    >
                      Ask Follow-up
                    </Button>
                    <Button 
                      variant="outline"
                      size="sm"
                      onClick={() => onSetFollowUpMode(false)}
                    >
                      New Search
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-center p-6">
          <div className="bg-gray-100 p-6 rounded-full mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2">Start a conversation</h3>
          <p className="text-sm text-gray-500 max-w-xs">
            Ask about software tools you need, and I'll help you find the best options for your requirements.
          </p>
        </div>
      )}
      {isLoading && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-pulse flex space-x-1">
            <div className="h-2 w-2 bg-gray-400 rounded-full"></div>
            <div className="h-2 w-2 bg-gray-400 rounded-full"></div>
            <div className="h-2 w-2 bg-gray-400 rounded-full"></div>
          </div>
        </div>
      )}
    </div>
  );
}

// New: ChatInputArea Component
interface ChatInputAreaProps {
  input: string;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement> | React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleFormSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  isLoading: boolean;
  isFollowUpMode: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  formRef: React.RefObject<HTMLFormElement>;
  error: Error | undefined;
  onDebugClick: () => void; // Pass the debug handler
}

function ChatInputArea({ 
  input, 
  handleInputChange, 
  handleFormSubmit, 
  isLoading, 
  isFollowUpMode, 
  inputRef, 
  formRef, 
  error, 
  onDebugClick 
}: ChatInputAreaProps) {
  return (
    <div className="w-full bg-white py-4 px-2 border-t">
      <form onSubmit={handleFormSubmit} ref={formRef} className="flex items-center space-x-2">
        <Input
          ref={inputRef}
          className="flex-grow"
          value={input}
          placeholder={isFollowUpMode ? "Ask a follow-up question..." : "Ask about SaaS tools..."}
          onChange={handleInputChange}
          disabled={isLoading}
        />
        <Button
          type="submit"
          disabled={isLoading || !input.trim()}
        >
          Send
        </Button>
      </form>
      {error && <div className="mt-2 text-red-500 text-sm">Error: {error.message}</div>}
      
      {process.env.NODE_ENV === 'development' && (
        <Button 
          onClick={onDebugClick}
          variant="outline"
          size="sm"
          className="mt-4"
        >
          Debug in Console
        </Button>
      )}
    </div>
  );
}

// New: ToolRecommendationsPanel Component
interface ToolRecommendationsPanelProps {
  tools: ToolCardProps[];
}

function ToolRecommendationsPanel({ tools }: ToolRecommendationsPanelProps) {
  const { messages } = useChat();
  
  // Check if the AI has given a response yet
  const hasAIResponded = useMemo(() => {
    return messages.some(m => m.role === 'assistant');
  }, [messages]);
  
  if (!tools || tools.length === 0) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <div className="bg-gray-100 p-6 rounded-full mb-4">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
            <path d="M5 8h14"></path>
            <path d="M5 12h14"></path>
            <path d="M5 16h14"></path>
            <path d="M18 20V4H6v16h12z"></path>
          </svg>
        </div>
        <h3 className="text-lg font-medium mb-2">
          {hasAIResponded ? "No matching tools found" : "No recommendations yet"}
        </h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto">
          {hasAIResponded 
            ? "We don't have tools in our database that match your specific needs. Try asking about different software categories."
            : "Ask me about software tools you need, and I'll provide personalized recommendations here."
          }
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {tools.map((tool) => (
        <ToolCard key={tool.id} {...tool} />
      ))}
    </div>
  );
}

export default function Chat() {
  const [enhancedMessages, setEnhancedMessages] = useState<MessageWithCards[]>([]);
  const [allRecommendedTools, setAllRecommendedTools] = useState<ToolCardProps[]>([]);
  const [isFollowUpMode, setIsFollowUpMode] = useState<boolean>(false);
  const [inputVisible, setInputVisible] = useState<boolean>(true);
  const [userRequestedInput, setUserRequestedInput] = useState<boolean>(false);
  const [shouldResetChat, setShouldResetChat] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string>(() => Date.now().toString());
  const [recommendationsPanelKey, setRecommendationsPanelKey] = useState<number>(0);
  const streamingMessageIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    error,
    isLoading,
    data,
    reload,
    setMessages,
    append,
  } = useChat({
    onFinish: () => {
      streamingMessageIdRef.current = null;
    },
    body: useMemo(() => {
      const baseBody: Record<string, any> = {
        isFollowUp: isFollowUpMode,
      };
      if (isFollowUpMode && allRecommendedTools.length > 0) {
        baseBody.recommendedToolIds = allRecommendedTools.map(tool => tool.id);
      }
      return baseBody;
    }, [isFollowUpMode, allRecommendedTools]),
    onResponse: () => {
      // We might not need to set isFollowUpMode to false here anymore,
      // let's see if the flow works better without it for now.
      // setIsFollowUpMode(false); 
    },
    id: sessionId,
  });

  useEffect(() => {
    if (isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant' && streamingMessageIdRef.current !== lastMessage.id) {
        streamingMessageIdRef.current = lastMessage.id;
      }
    }
  }, [isLoading, messages]);

  useEffect(() => {
    let toolCards: ToolCardProps[] = [];
    if (Array.isArray(data)) {
      for (const dataItem of data) {
        if (Array.isArray(dataItem)) {
          const validCards = dataItem
            .filter(item => item && typeof item === 'object')
            .filter(isToolCardProps);
          if (validCards.length > 0) {
            toolCards = validCards as unknown as ToolCardProps[];
            break;
          }
        }
      }
    }

    let targetMessageIdForCards: string | null = null;
    if (toolCards.length > 0 && !isLoading && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === 'assistant') {
        targetMessageIdForCards = lastMessage.id;

        // Only set recommended tools if we're not in the process of resetting
        if (!shouldResetChat) {
          setAllRecommendedTools(prev => {
            const newTools = toolCards.filter(
              tool => !prev.some(existingTool => existingTool.id === tool.id)
            );
            if (newTools.length > 0) {
              return [...prev, ...newTools];
            }
            return prev;
          });
        }
      }
    }

    // Don't process messages if we're resetting
    if (!shouldResetChat) {
      const processedMessages: MessageWithCards[] = messages.map(message => {
        const messageWithCards: MessageWithCards = { ...message };

        const existingEnhancedMessage = enhancedMessages.find(em => em.id === message.id);

        if (
          message.id === targetMessageIdForCards && 
          toolCards.length > 0 &&
          (!existingEnhancedMessage || !existingEnhancedMessage.cards || existingEnhancedMessage.cards.length === 0)
        ) {
          messageWithCards.cards = toolCards;
        } else {
          messageWithCards.cards = existingEnhancedMessage?.cards || undefined;
        }
        
        return messageWithCards;
      });
      
      if (JSON.stringify(processedMessages) !== JSON.stringify(enhancedMessages)) {
        setEnhancedMessages(processedMessages);
        
        // Scroll to bottom when new messages are added
        setTimeout(() => {
          const chatContainer = document.querySelector('.chat-container');
          if (chatContainer) {
            chatContainer.scrollTop = chatContainer.scrollHeight;
          }
        }, 100);

        // Modified input visibility logic to respect user requests
        const latestLastMessage = processedMessages[processedMessages.length - 1];
        const shouldHideInput = 
          latestLastMessage && // Check if message exists
          latestLastMessage.role === 'assistant' && 
          latestLastMessage.cards && 
          latestLastMessage.cards.length > 0 &&
          !isLoading && // Only hide if the message is fully loaded
          !userRequestedInput; // Don't hide if user has explicitly requested input

        if (shouldHideInput) {
          setInputVisible(false);
        } else if (!isLoading) { 
          // Show input if the last message doesn't warrant hiding it 
          // (e.g., user message, assistant clarification without cards)
          // This ensures input reappears after non-card responses.
          setInputVisible(true);
        }
        // If still loading, visibility remains unchanged until loading finishes.
      }
    }
  }, [messages, data, isLoading, enhancedMessages, userRequestedInput, shouldResetChat]);

  useEffect(() => {
    if (shouldResetChat) {
      const newSessionId = Date.now().toString();
      setSessionId(newSessionId);
      
      setMessages([]);
      setAllRecommendedTools([]);
      setEnhancedMessages([]);
      setIsFollowUpMode(false);
      setInputVisible(true);
      setUserRequestedInput(false);
      setShouldResetChat(false);
      setRecommendationsPanelKey(prev => prev + 1);
    }
  }, [shouldResetChat, setMessages]);

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleSubmit(event);
    // Ensure input is always visible after submitting a message
    setInputVisible(true);
    // Reset user request flag when a message is sent
    setUserRequestedInput(false);
  };

  // Function to handle suggestion clicks
  const handleSuggestionClick = (text: string) => {
    if (text.trim()) {
      append({
        role: 'user',
        content: text,
      });
    }
  };

  const handleSetFollowUpMode = (isFollowUp: boolean) => {
    if (isFollowUp) {
      // Follow-up mode
      setIsFollowUpMode(true);
      setInputVisible(true);
      inputRef.current?.focus();
    } else {
      // New search - immediately flag for complete reset
      setShouldResetChat(true);
      
      // Perform immediate UI changes first
      setAllRecommendedTools([]); // Clear recommendations immediately
      setInputVisible(true); // Show input field immediately
      setIsFollowUpMode(false); // Reset follow-up mode flag
      
      // Force immediate UI refresh with a synchronous state update
      setEnhancedMessages([]); // Clear messages from UI immediately
      
      // Focus the input field
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  };

  // Debug click handler (passed to ChatInputArea)
  const handleDebugClick = () => {
    console.log({ enhancedMessages, data, allRecommendedTools, streamingId: streamingMessageIdRef.current });
  };

  return (
    <div className="flex flex-col md:flex-row w-full min-h-screen h-screen overflow-hidden">
      {/* Left Column: Chat Area */}
      <div className="flex flex-col w-full md:w-3/5 h-full bg-gray-50">
        <div className="bg-white p-4 border-b shadow-sm z-10">
          <h1 className="text-xl font-bold">Software Assistant</h1>
          <p className="text-sm text-gray-500">Chat with AI to discover the best software tools for your needs</p>
        </div>
        
        <div className="flex-grow flex flex-col h-[calc(100%-140px)] overflow-hidden">
          {/* Chat Messages */}
          <ChatMessages 
            messages={enhancedMessages}
            isLoading={isLoading}
            onSetFollowUpMode={handleSetFollowUpMode}
            onSubmitSuggestion={handleSuggestionClick}
          />
        </div>

        {/* Input Area */}
        {inputVisible && (
          <ChatInputArea 
            input={input}
            handleInputChange={handleInputChange}
            handleFormSubmit={handleFormSubmit}
            isLoading={isLoading}
            isFollowUpMode={isFollowUpMode}
            inputRef={inputRef as React.RefObject<HTMLInputElement>}
            formRef={formRef as React.RefObject<HTMLFormElement>}
            error={error}
            onDebugClick={handleDebugClick}
          />
        )}
      </div>

      {/* Right Column: Tool Recommendations */}
      <div className="w-full md:w-2/5 h-full border-l bg-white overflow-hidden">
        <div className="bg-white p-4 border-b shadow-sm z-10">
          <h2 className="text-xl font-bold">Recommended Tools</h2>
          <p className="text-sm text-gray-500">Software recommendations based on your conversation</p>
        </div>
        <div className="h-[calc(100%-72px)] overflow-y-auto">
          <ToolRecommendationsPanel 
            key={recommendationsPanelKey} 
            tools={allRecommendedTools} 
          />
        </div>
      </div>
    </div>
  );
}
