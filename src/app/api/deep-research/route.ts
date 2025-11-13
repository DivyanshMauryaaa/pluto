// app/api/deep-research/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { supabase } from '@/lib/supabase';

const api = new OpenAI({
    apiKey: process.env.NEXT_PUBLIC_AIML_API_KEY!,
    baseURL: process.env.NEXT_PUBLIC_AIML_BASE_URL!,
});

interface Source {
    url: string;
    title: string;
    snippet: string;
    content: string;
}

interface KeyPoint {
    point: string;
    date: string;
    source: string;
}

function extractBulletPoints(text: string): string[] {
    if (!text) return [];

    const lines = text.split(/\r?\n/);
    const bullets: string[] = [];
    let current = '';

    const bulletPattern = /^\s*(?:[-*•+]|[0-9]{1,3}[.)])\s+(.*)$/;

    for (const line of lines) {
        const match = line.match(bulletPattern);

        if (match) {
            if (current.trim()) {
                bullets.push(current.trim());
            }
            current = match[1].trim();
        } else if (line.trim()) {
            current += ` ${line.trim()}`;
        } else if (current.trim()) {
            bullets.push(current.trim());
            current = '';
        }
    }

    if (current.trim()) {
        bullets.push(current.trim());
    }

    return bullets;
}

function normalizePoints(raw: any, fallbackText: string): any[] {
    if (Array.isArray(raw)) {
        return raw;
    }

    if (raw && typeof raw === 'object') {
        const candidates = [
            raw.points,
            raw.key_points,
            raw.keyPoints,
            raw.items,
            raw.data,
            raw.results,
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate)) {
                return candidate;
            }
        }
    }

    // Fallback: attempt to parse bullet points from text
    const bulletStrings = extractBulletPoints(fallbackText);
    if (bulletStrings.length > 0) {
        return bulletStrings;
    }

    return [];
}

// Helper function to extract and parse JSON from LLM responses
function extractJSON(text: string): any {
    try {
        // First, try parsing directly
        return JSON.parse(text);
    } catch {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[1].trim());
        }

        // Try to find JSON array or object patterns
        const arrayMatch = text.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            return JSON.parse(arrayMatch[0]);
        }

        const objectMatch = text.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            return JSON.parse(objectMatch[0]);
        }

        throw new Error('No valid JSON found in response');
    }
}

export async function POST(req: NextRequest) {
    try {
        const { prompt, chatId } = await req.json();

        if (!prompt || !chatId) {
            return NextResponse.json(
                { error: 'Missing prompt or chatId' },
                { status: 400 }
            );
        }

        // Step 1: Generate search terms from different perspectives
        const searchTermsResponse = await api.chat.completions.create({
            model: "google/gemini-2.0-flash",
            messages: [
                {
                    role: "system",
                    content: `Generate 5 diverse search terms for the given research prompt. 
Consider different perspectives, aspects, and angles of the topic.
Return ONLY a JSON array of strings, no markdown, no code blocks, no other text.
Example: ["term 1", "term 2", "term 3", "term 4", "term 5"]`
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 200,
        });

        const searchTermsText = searchTermsResponse.choices[0].message.content || '[]';
        const searchTerms: string[] = extractJSON(searchTermsText);

        // Step 2: Search using SERP API for each term
        const allSources: Source[] = [];

        for (const term of searchTerms.slice(0, 5)) {
            try {
                const serpResponse = await fetch(
                    `https://serpapi.com/search?q=${encodeURIComponent(term)}&api_key=${process.env.SERP_API_KEY}&num=1`
                );
                const serpData = await serpResponse.json();

                if (serpData.organic_results && serpData.organic_results.length > 0) {
                    const result = serpData.organic_results[0];
                    allSources.push({
                        url: result.link,
                        title: result.title,
                        snippet: result.snippet || '',
                        content: ''
                    });
                }
            } catch (error) {
                console.error(`Error searching for "${term}":`, error);
            }
        }

        // Limit to 5 sources
        const sources = allSources.slice(0, 5);

        // Step 3: Scrape content from each source using ScrapingAnt
        for (const source of sources) {
            try {
                const scrapeResponse = await fetch(
                    `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(source.url)}&x-api-key=${process.env.SCRAPINGANT_API_KEY}&browser=false`
                );
                const scrapeData = await scrapeResponse.json();

                if (scrapeData.content) {
                    // Extract paragraphs using regex
                    const paragraphs = scrapeData.content.match(/<p[^>]*>(.*?)<\/p>/gis) || [];
                    const cleanedParagraphs = paragraphs
                        .map((p: string) => p.replace(/<[^>]+>/g, '').trim())
                        .filter((p: string) => p.length > 50);

                    source.content = cleanedParagraphs.join('\n\n');
                }
            } catch (error) {
                console.error(`Error scraping ${source.url}:`, error);
            }
        }

        // Step 4: Extract key points from each source
        const allKeyPoints: KeyPoint[] = [];

        for (const source of sources) {
            if (!source.content) continue;

            try {
                const extractionResponse = await api.chat.completions.create({
                    model: "google/gemini-2.0-flash",
                    messages: [
                        {
                            role: "system",
                            content: `Extract EVERY key point from the provided text. Do not miss any important information.
Extract comprehensively - it's okay if points repeat across sources.

For each point, try to extract or infer a date (publication date, event date, or "recent" if no date).

Return ONLY a JSON array of objects, no markdown, no code blocks, no other text.
Structure: [{"point": "key point text", "date": "YYYY-MM-DD or 'recent' or 'undated'"}]

Be thorough and extract ALL meaningful information.`
                        },
                        {
                            role: "user",
                            content: `Source: ${source.title}\nURL: ${source.url}\n\nContent:\n${source.content.slice(0, 8000)}`
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2000,
                });

                const pointsText = extractionResponse.choices[0].message.content || '[]';

                let parsedPoints: any = null;
                try {
                    parsedPoints = extractJSON(pointsText);
                } catch (parseError) {
                    console.warn(`Failed to parse JSON for ${source.url}:`, parseError);
                }

                const normalizedPoints = normalizePoints(parsedPoints, pointsText);

                normalizedPoints.forEach((p: any) => {
                    if (!p) return;

                    const pointText = typeof p === 'string' ? p : p.point || p.text || p.summary || '';
                    if (!pointText.trim()) return;

                    allKeyPoints.push({
                        point: pointText.trim(),
                        date: (typeof p === 'object' && (p.date || p.timestamp || p.published_at)) || 'undated',
                        source: source.url
                    });
                });
            } catch (error) {
                console.error(`Error extracting points from ${source.url}:`, error);
            }
        }

        // Step 5: Deduplicate and keep latest versions
        const pointsMap = new Map<string, KeyPoint>();

        for (const kp of allKeyPoints) {
            const normalizedPoint = kp.point.toLowerCase().trim();

            if (!pointsMap.has(normalizedPoint)) {
                pointsMap.set(normalizedPoint, kp);
            } else {
                const existing = pointsMap.get(normalizedPoint)!;

                // Compare dates - keep the more recent one
                if (kp.date !== 'undated' && kp.date !== 'recent') {
                    if (existing.date === 'undated' || existing.date === 'recent') {
                        pointsMap.set(normalizedPoint, kp);
                    } else {
                        try {
                            if (new Date(kp.date) > new Date(existing.date)) {
                                pointsMap.set(normalizedPoint, kp);
                            }
                        } catch {
                            // Invalid date format, skip comparison
                        }
                    }
                }
            }
        }

        const uniqueKeyPoints = Array.from(pointsMap.values());

        // Step 6: Create observation markdown
        const observationMd = `# Research Observations

## Sources Analyzed
${sources.map((s, i) => `${i + 1}. [${s.title}](${s.url})`).join('\n')}

## Key Points Extracted

${uniqueKeyPoints.length > 0
                ? uniqueKeyPoints.map(kp => `- **${kp.point}** ${kp.date && kp.date !== 'undated' ? `_(${kp.date})_` : ''}`).join('\n')
                : '- No key points could be extracted from the available sources.'}

---
*Total sources: ${sources.length} | Key points: ${uniqueKeyPoints.length}*
`;

        // Step 7: Generate final research summary
        const summaryResponse = await api.chat.completions.create({
            model: "google/gemini-2.0-flash",
            messages: [
                {
                    role: "system",
                    content: `You are a research synthesizer. Create a comprehensive, well-structured research summary based on the provided key points.

Guidelines:
- Organize information logically with clear sections
- Synthesize information from multiple perspectives
- Highlight the most recent and relevant findings
- Maintain accuracy and cite information appropriately
- Be thorough but concise
- Use markdown formatting for readability`
                },
                {
                    role: "user",
                    content: `Research Prompt: ${prompt}

Key Points:
${JSON.stringify(uniqueKeyPoints, null, 2)}

Create a comprehensive research summary addressing the prompt.`
                }
            ],
            temperature: 0.7,
            max_tokens: 16000,
        });

        const researchSummary = summaryResponse.choices[0].message.content || 'Unable to generate summary.';

        // Step 8: Store in Supabase
        const { data: researchData, error: researchError } = await supabase
            .from('researches')
            .insert({
                user_id: chatId,
                name: prompt.slice(0, 100),
                context: JSON.stringify({ searchTerms, sources: sources.map(s => ({ url: s.url, title: s.title })) }),
                observations: observationMd,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (researchError) {
            console.error('Error storing research:', researchError);
        }

        return NextResponse.json({
            success: true,
            observation: observationMd,
            summary: researchSummary,
            researchId: researchData?.id,
            sources: sources.length,
            keyPoints: uniqueKeyPoints.length
        });

    } catch (error: any) {
        console.error('Deep research error:', error);
        return NextResponse.json(
            { error: error.message || 'Research failed' },
            { status: 500 }
        );
    }
}