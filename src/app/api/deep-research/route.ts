// app/api/deep-research/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { supabase } from '@/lib/supabase';
import { SEARCH_TERM_GENERATION_PROMPT, KEY_POINT_EXTRACTION_PROMPT, RESEARCH_SYNTHESIS_PROMPT } from '@/prompts';

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
    // If we have a valid array, return it
    if (Array.isArray(raw) && raw.length > 0) {
        return raw;
    }

    // If we have an object, try to find an array property
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const candidates = [
            raw.points,
            raw.key_points,
            raw.keyPoints,
            raw.items,
            raw.data,
            raw.results,
            raw.extracted_points,
            raw.extractedPoints,
        ];

        for (const candidate of candidates) {
            if (Array.isArray(candidate) && candidate.length > 0) {
                return candidate;
            }
        }
    }

    // Fallback: attempt to parse bullet points from text
    if (fallbackText && typeof fallbackText === 'string') {
        const bulletStrings = extractBulletPoints(fallbackText);
        if (bulletStrings.length > 0) {
            // Convert plain strings to objects with point property
            return bulletStrings.map(str => ({
                point: str,
                date: 'undated'
            }));
        }

        // Try to extract numbered or bulleted lists even if not in standard format
        const lines = fallbackText.split(/\r?\n/);
        const extracted: string[] = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            // Look for lines that start with numbers, bullets, or dashes
            if (/^[\d\-\*•\+]\s+/.test(trimmed) || /^[a-z]\)\s+/.test(trimmed)) {
                const point = trimmed.replace(/^[\d\-\*•\+a-z\)]\s+/, '').trim();
                if (point.length > 10) { // Only include substantial points
                    extracted.push(point);
                }
            }
        }

        if (extracted.length > 0) {
            return extracted.map(str => ({
                point: str,
                date: 'undated'
            }));
        }
    }

    return [];
}

// Helper function to extract and parse JSON from LLM responses
function extractJSON(text: string): any {
    if (!text || typeof text !== 'string') {
        throw new Error('Invalid input: text must be a non-empty string');
    }

    const trimmed = text.trim();
    if (!trimmed) {
        throw new Error('Empty text provided');
    }

    try {
        // First, try parsing directly
        return JSON.parse(trimmed);
    } catch (e) {
        // If that fails, try to extract JSON from markdown code blocks
        const jsonMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
        if (jsonMatch) {
            try {
                return JSON.parse(jsonMatch[1].trim());
            } catch (e2) {
                // Continue to next attempt
            }
        }

        // Try to find JSON array pattern (most common for our use case)
        const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
            try {
                return JSON.parse(arrayMatch[0]);
            } catch (e2) {
                // Continue to next attempt
            }
        }

        // Try to find JSON object pattern
        const objectMatch = trimmed.match(/\{[\s\S]*\}/);
        if (objectMatch) {
            try {
                const parsed = JSON.parse(objectMatch[0]);
                // If it's an object with a points/key_points array, extract that
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    if (Array.isArray(parsed.points)) return parsed.points;
                    if (Array.isArray(parsed.key_points)) return parsed.key_points;
                    if (Array.isArray(parsed.keyPoints)) return parsed.keyPoints;
                    if (Array.isArray(parsed.data)) return parsed.data;
                }
                return parsed;
            } catch (e2) {
                // Continue to next attempt
            }
        }

        // Try to fix common JSON issues
        let fixed = trimmed
            .replace(/^[^\[\{]*/, '') // Remove leading non-JSON text
            .replace(/[^\]\}]*$/, '') // Remove trailing non-JSON text
            .trim();

        if (fixed) {
            try {
                return JSON.parse(fixed);
            } catch (e2) {
                // Last attempt failed
            }
        }

        throw new Error(`No valid JSON found in response. First 200 chars: ${trimmed.substring(0, 200)}`);
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
            model: "google/gemini-2.5-flash",
            messages: [
                {
                    role: "system",
                    content: SEARCH_TERM_GENERATION_PROMPT
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
            if (!source.content) {
                console.warn(`Skipping source ${source.url} - no content`);
                continue;
            }

            try {
                const extractionResponse = await api.chat.completions.create({
                    model: "google/gemini-2.5-flash",
                    messages: [
                        {
                            role: "system",
                            content: KEY_POINT_EXTRACTION_PROMPT
                        },
                        {
                            role: "user",
                            content: `Source: ${source.title}\nURL: ${source.url}\n\nContent:\n${source.content.split(/\s+/).slice(0, 8000).join(' ')}`
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 3500
                });

                const pointsText = extractionResponse.choices[0].message.content || '[]';
                console.log(`Raw extraction response for ${source.url}:`, pointsText.substring(0, 500));

                let parsedPoints: any = null;
                try {
                    parsedPoints = extractJSON(pointsText);
                    console.log(`Successfully parsed ${Array.isArray(parsedPoints) ? parsedPoints.length : 'non-array'} points from ${source.url}`);
                } catch (parseError) {
                    console.warn(`Failed to parse JSON for ${source.url}:`, parseError);
                    console.warn(`Response text (first 1000 chars):`, pointsText.substring(0, 1000));
                }

                const normalizedPoints = normalizePoints(parsedPoints, pointsText);
                console.log(`Normalized to ${normalizedPoints.length} points from ${source.url}`);

                if (normalizedPoints.length === 0) {
                    console.warn(`No points extracted from ${source.url}. Raw response:`, pointsText.substring(0, 500));
                }

                normalizedPoints.forEach((p: any) => {
                    if (!p) return;

                    const pointText = typeof p === 'string' ? p : p.point || p.text || p.summary || p.content || '';
                    if (!pointText.trim()) return;

                    const dateValue = typeof p === 'object' 
                        ? (p.date || p.timestamp || p.published_at || p.time || 'undated')
                        : 'undated';

                    allKeyPoints.push({
                        point: pointText.trim(),
                        date: dateValue === 'no_date' ? 'undated' : (dateValue || 'undated'),
                        source: source.url
                    });
                });

                console.log(`Added ${normalizedPoints.length} key points from ${source.url}. Total so far: ${allKeyPoints.length}`);
            } catch (error) {
                console.error(`Error extracting points from ${source.url}:`, error);
                if (error instanceof Error) {
                    console.error(`Error details:`, error.message, error.stack);
                }
            }
        }

        console.log(`Total key points extracted: ${allKeyPoints.length}`);

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
            model: "google/gemini-2.5-flash",
            messages: [
                {
                    role: "system",
                    content: RESEARCH_SYNTHESIS_PROMPT
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