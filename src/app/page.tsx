'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/lib/supabase';
import { useUser } from '@clerk/nextjs';
import { Search, Send, Loader2, Sparkles, Bot, User, BookOpen } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { OpenAI } from 'openai/client.js';
import MarkdownRenderer from '@/components/ui/mdrenderer';

const api = new OpenAI({
  apiKey: process.env.NEXT_PUBLIC_AIML_API_KEY!,
  baseURL: process.env.NEXT_PUBLIC_AIML_BASE_URL!,
  dangerouslyAllowBrowser: true
});

// Streaming Message Component
const StreamingMessage = ({ content, isComplete }: { content: string; isComplete: boolean }) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const startTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isComplete || !content) {
      setDisplayedContent('');
      return;
    }

    const totalDuration = 1000; // 1 second total
    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      if (!startTimeRef.current) return;

      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / totalDuration, 1);
      const targetIndex = Math.max(1, Math.floor(progress * content.length));

      setDisplayedContent(content.slice(0, targetIndex));

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayedContent(content);
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [content, isComplete]);

  return (
    <p className='whitespace-pre-wrap break-words leading-relaxed'>
      <MarkdownRenderer content={displayedContent} />
      {isComplete && displayedContent.length < content.length && (
        <span className='inline-block w-1 h-4 bg-current ml-0.5 animate-pulse' />
      )}
    </p>
  );
};

export default function Home() {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [currentChatId, setCurrentChatId] = useState("");
  const [currentChatMessages, setCurrentChatMessages] = useState<any>([]);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState('Idle');
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { user } = useUser();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentChatMessages, sending]);

  // Load chat from URL parameter on mount
  useEffect(() => {
    const chatId = searchParams.get('c');
    if (chatId) {
      setCurrentChatId(chatId);
      loadChatMessages(chatId);
    }
  }, [searchParams]);

  const loadChatMessages = async (chatId: string) => {
    setLoading(true);
    const { data, error } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('chatId', chatId)
      .order('createdAt', { ascending: true });

    if (error) {
      console.error(error);
    } else {
      setCurrentChatMessages(data || []);
    }
    setLoading(false);
  };

  const buildConversationHistory = (messages: any[]) => {
    return messages.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
  };

  const deepResearch = async (prompt: string, chatId: string) => {
    setState('Deep Researching');

    try {
      // Call deep research API
      const response = await fetch('/api/deep-research', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          chatId
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Research failed');
      }

      // Insert observation as assistant message
      const { data: obsMessage } = await supabase
        .from('chat_messages')
        .insert({
          chatId: chatId,
          content: `## 📊 Research Observations\n\n${data.observation}`,
          role: 'assistant',
        })
        .select()
        .single();

      if (obsMessage) {
        setStreamingMessageId(obsMessage.id);
      }

      // Reload messages
      await loadChatMessages(chatId);

      // Wait a bit before showing summary
      await new Promise(resolve => setTimeout(resolve, 500));

      // Insert summary as assistant message
      const { data: summaryMessage } = await supabase
        .from('chat_messages')
        .insert({
          chatId: chatId,
          content: `## 📝 Research Summary\n\n${data.summary}\n\n---\n*Sources analyzed: ${data.sources} | Key points extracted: ${data.keyPoints}*`,
          role: 'assistant',
        })
        .select()
        .single();

      if (summaryMessage) {
        setStreamingMessageId(summaryMessage.id);
      }

      // Reload messages again
      await loadChatMessages(chatId);

      setState('Idle');
      return data.summary;
    } catch (error) {
      console.error('Error in deep research:', error);
      setState('Idle');

      // Insert error message
      await supabase
        .from('chat_messages')
        .insert({
          chatId: chatId,
          content: "❌ I encountered an error during deep research. Please try again.",
          role: 'assistant',
        });

      await loadChatMessages(chatId);
      return null;
    }
  };

  const parseAndExecuteResearch = async (response: string, chatId: string) => {
    // Check if AI wants to start research
    const researchRegex = /<startResearch prompt="([^"]+)">/g;
    const matches = [...response.matchAll(researchRegex)];

    if (matches.length > 0) {
      // Execute research for each match sequentially
      for (const match of matches) {
        const researchPrompt = match[1];
        await deepResearch(researchPrompt, chatId);
      }
    }
  };

  const handleStartResearch = async () => {
    if (!message.trim() || sending) return;

    setSending(true);
    const userMessage = message;

    try {
      let chatId = currentChatId;

      if (!chatId) {
        // Create new chat
        const { data, error } = await supabase
          .from('chats')
          .insert({
            user_id: user?.id,
            title: userMessage.split(' ').slice(0, 5).join(' '),
          })
          .select()
          .single();

        if (error) {
          console.error(error);
          setSending(false);
          return;
        }

        chatId = data.id;
        setCurrentChatId(chatId);

        // Update URL with chat ID
        router.push(`/?c=${chatId}`);
      }

      // Insert user message
      await supabase
        .from('chat_messages')
        .insert({
          chatId: chatId,
          content: userMessage,
          role: 'user',
        });

      // Reload messages to include the new user message IMMEDIATELY
      await loadChatMessages(chatId);

      setState('Thinking');

      // Build conversation history for context
      const { data: currentMessages } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('chatId', chatId)
        .order('createdAt', { ascending: true });

      const conversationHistory = buildConversationHistory(currentMessages || []);

      // Call AI with conversation history
      const completion = await api.chat.completions.create({
        model: "google/gemini-2.0-flash",
        messages: [
          {
            role: "system",
            content: `You are Pluto, an intelligent research assistant. You help users explore topics deeply by providing insightful responses and conducting detailed research when needed.

Your capabilities:
- Engage in natural, conversational dialogue
- Break down complex topics into understandable explanations
- Trigger deep research using: <startResearch prompt="specific research query"> when user demands, or when you feel like.
- Provide immediate insights while research is being conducted
- Synthesize information from multiple sources

When to use <startResearch>:
- User asks for detailed information on a specific topic
- Question requires current data, statistics, or comprehensive analysis
- Topic needs multi-faceted exploration
- User explicitly requests research or deep dive

Response guidelines:
1. Always acknowledge the user's question naturally
2. Provide an initial thoughtful response based on general knowledge
3. If research would be valuable, explain what you'll research and trigger it
4. Use <startResearch prompt="your detailed research query"> when appropriate
5. Keep your tone conversational, helpful, and engaging
6. Don't overuse research - only when truly beneficial

Example response structure:
"That's a great question about [topic]! Let me share some initial thoughts...

[Your immediate insights here]

To give you more comprehensive information, I'll research this in detail.
<startResearch prompt="detailed analysis of [specific aspect]">

The research results will provide deeper insights into [what they'll learn]." If the user's response requires for a research. Otherwise, you can stick to normal chatting

Remember: Be natural, helpful, and use research strategically to enhance the conversation.`
          },
          ...conversationHistory
        ],
        temperature: 0.7,
        max_tokens: 1500,
      });

      const response = completion.choices[0].message.content;

      // Remove research tags from display content
      const cleanResponse = response?.replace(/<startResearch prompt="[^"]+">/g, '').trim() || "I apologize, but I couldn't generate a response. Please try again.";

      // Insert AI response (without research tags)
      const { data: insertedMessage } = await supabase
        .from('chat_messages')
        .insert({
          chatId: chatId,
          content: cleanResponse,
          role: 'assistant',
        })
        .select()
        .single();

      // Set the streaming message ID to trigger animation
      if (insertedMessage) {
        setStreamingMessageId(insertedMessage.id);
      }

      // Reload messages to include the AI response
      await loadChatMessages(chatId);

      setState('Idle');

      // Parse and execute research if AI requested it
      if (response) {
        await parseAndExecuteResearch(response, chatId);
      }

      setMessage('')

    } catch (error) {
      console.error('Error in handleStartResearch:', error);

      // Insert error message
      if (currentChatId) {
        await supabase
          .from('chat_messages')
          .insert({
            chatId: currentChatId,
            content: "I encountered an error while processing your request. Please try again.",
            role: 'assistant',
          });
        await loadChatMessages(currentChatId);
      }
      setState('Idle');
    }

    setSending(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleStartResearch();
    }
  };

  return (
    <div className='flex flex-col'>
      {/* Messages Area */}
      <div className='flex-1 overflow-y-auto pb-32'>
        <div className='max-w-4xl mx-auto px-6 py-8'>
          {loading ? (
            <div className='flex items-center justify-center h-64'>
              <Loader2 className='w-8 h-8 animate-spin text-primary' />
            </div>
          ) : currentChatMessages.length > 0 ? (
            <div className='flex flex-col gap-6'>
              {currentChatMessages.map((msg: any, index: number) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-4 duration-500`}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  {msg.role === 'assistant' && (
                    <div className='flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center'>
                      <Bot className='w-5 h-5 text-white' />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === 'user'
                      ? 'bg-primary text-primary-foreground shadow-md'
                      : 'bg-muted/50 backdrop-blur w-5xl'
                      }`}
                  >
                    {msg.role === 'assistant' && msg.id === streamingMessageId && !loading ? (
                      <StreamingMessage content={msg.content} isComplete={state === 'Idle'} />
                    ) : (
                      <MarkdownRenderer content={msg.content} />
                    )}
                  </div>
                  {msg.role === 'user' && (
                    <div className='flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center'>
                      <User className='w-5 h-5' />
                    </div>
                  )}
                </div>
              ))}
              {sending && state !== 'Idle' && (
                <div className='flex gap-3 justify-start'>
                  <div className='flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center'>
                    <Bot className='w-5 h-5 text-white' />
                  </div>
                  <div className='bg-muted/50 backdrop-blur rounded-2xl px-4 py-3 flex items-center gap-3'>
                    <Loader2 className='w-5 h-5 animate-spin' />
                    <span>{state}...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          ) : (
            <div className='flex flex-col items-center justify-center h-[calc(100vh-300px)] text-center'>
              <h2 className='text-3xl font-bold mb-2'>
                Hey {user?.firstName}! What shall we explore today?
              </h2>
              <p className='text-muted-foreground mb-8 max-w-md'>
                I'm Pluto, your research assistant. Ask me anything and I'll help you dive deep into any topic.
              </p>
              <div className='grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl'>
                <button
                  onClick={() => setMessage("Explain quantum computing in simple terms")}
                  className='p-4 text-left rounded-xl border bg-card hover:bg-accent transition-colors'
                >
                  <BookOpen className='w-5 h-5 mb-2 text-primary' />
                  <p className='font-medium text-sm'>Explain quantum computing</p>
                </button>
                <button
                  onClick={() => setMessage("What are the latest developments in AI?")}
                  className='p-4 text-left rounded-xl border bg-card hover:bg-accent transition-colors'
                >
                  <Sparkles className='w-5 h-5 mb-2 text-primary' />
                  <p className='font-medium text-sm'>Latest AI developments</p>
                </button>
                <button
                  onClick={() => setMessage("Research renewable energy trends")}
                  className='p-4 text-left rounded-xl border bg-card hover:bg-accent transition-colors'
                >
                  <Search className='w-5 h-5 mb-2 text-primary' />
                  <p className='font-medium text-sm'>Renewable energy trends</p>
                </button>
                <button
                  onClick={() => setMessage("How does the human brain process emotions?")}
                  className='p-4 text-left rounded-xl border bg-card hover:bg-accent transition-colors'
                >
                  <Bot className='w-5 h-5 mb-2 text-primary' />
                  <p className='font-medium text-sm'>Brain and emotions</p>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 fixed bottom-0 right-0 left-0 transition-all duration-300">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex gap-3 items-end">
            {/* Input Area */}
            <div className="flex-1 relative group">
              <Textarea
                rows={1}
                className="
            w-full resize-none min-h-[56px] max-h-[200px] py-4 pr-12 rounded-xl
            transition-all duration-300 ease-out
            border-t border-border/70
            shadow-none
            bg-background/80 backdrop-blur
            focus:border-primary/40 ring-none
            placeholder:text-muted-foreground/70 
          "
                placeholder={currentChatId ? "Ask a follow up" : "Ask any detail & I'll give you the best detailed research."}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyPress}
              />

              {/* Subtle pulse dot when typing */}
              <div
                className={`
            absolute right-3 bottom-3 w-2 h-2 rounded-full bg-primary/60 
            transition-opacity duration-300
            ${message.trim() ? 'opacity-100 animate-pulse' : 'opacity-0'}
          `}
              />
            </div>

            {/* Send Button */}
            {message && (
              <Button
                onClick={handleStartResearch}
                className={`
                      h-[56px] px-6 rounded-xl
                      relative overflow-hidden transition-all duration-300
                      active:scale-95
                      focus-visible:ring-2 focus-visible:ring-primary/40
                      hover:shadow-lg
                      disabled:opacity-60
                      ${sending && 'animate-spin rounded-full w-10 h-10'} 
                    `}
                disabled={!message.trim() || sending}
              >
                {sending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <div className="flex items-center gap-2">
                    <Search className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                )}
              </Button>
            )}
          </div>

          {/* Hint Text */}
          <p className="text-xs text-muted-foreground mt-2 text-center opacity-70 transition-opacity duration-300 hover:opacity-100">
            Press <kbd className="px-1 py-0.5 bg-muted rounded">Enter</kbd> to send •{' '}
            <kbd className="px-1 py-0.5 bg-muted rounded">Shift + Enter</kbd> for new line
          </p>
        </div>
      </div>
    </div>
  );
}