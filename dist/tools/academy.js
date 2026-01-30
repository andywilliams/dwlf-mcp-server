import { z } from 'zod';
import axios from 'axios';
const ACADEMY_BASE = 'https://academy.dwlf.co.uk/live';
const MANIFEST_TTL_MS = 15 * 60 * 1000; // 15 minutes
// ── Cached manifest ───────────────────────────────────────────────
let cachedManifest = null;
let cacheTimestamp = 0;
async function getManifest() {
    const now = Date.now();
    if (cachedManifest && now - cacheTimestamp < MANIFEST_TTL_MS) {
        return cachedManifest;
    }
    const { data } = await axios.get(`${ACADEMY_BASE}/manifest.json`, { timeout: 15000 });
    cachedManifest = data;
    cacheTimestamp = now;
    return data;
}
// ── Image URL rewriter ────────────────────────────────────────────
function rewriteImageUrls(markdown) {
    // Convert relative image paths to absolute CDN URLs
    // Handles: ![alt](assets/img/foo.svg)  and  ![alt](./assets/img/foo.svg)
    return markdown.replace(/!\[([^\]]*)\]\((?:\.\/)?assets\//g, `![$1](${ACADEMY_BASE}/assets/`);
}
// ── Tool registration ─────────────────────────────────────────────
export function registerAcademyTools(server) {
    // 1. List all tracks and lessons
    server.tool('dwlf_list_academy_tracks', 'List all DWLF Academy tracks and lessons. Use this to discover educational content about DWLF concepts — indicators, events, strategies, charting, and more.', {}, async () => {
        try {
            const manifest = await getManifest();
            return {
                content: [
                    { type: 'text', text: JSON.stringify(manifest, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error fetching academy manifest: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
    // 2. Get a single lesson by slug
    server.tool('dwlf_get_academy_lesson', 'Get the full content of a DWLF Academy lesson by slug. Returns markdown. Use dwlf_list_academy_tracks first to find available lessons.', {
        slug: z
            .string()
            .describe('Lesson slug from the academy manifest (e.g. "intro-to-indicators")'),
    }, async ({ slug }) => {
        try {
            const { data } = await axios.get(`${ACADEMY_BASE}/lessons/${slug}.md`, { timeout: 15000, responseType: 'text' });
            const content = rewriteImageUrls(data);
            return {
                content: [{ type: 'text', text: content }],
            };
        }
        catch (error) {
            const msg = axios.isAxiosError(error) && error.response?.status === 404
                ? `Lesson "${slug}" not found. Use dwlf_list_academy_tracks to see available lessons.`
                : `Error fetching lesson "${slug}": ${error instanceof Error ? error.message : String(error)}`;
            return {
                content: [{ type: 'text', text: msg }],
                isError: true,
            };
        }
    });
    // 3. Search academy content by keyword
    server.tool('dwlf_search_academy', 'Search DWLF Academy content by keyword. Searches track and lesson titles. Returns matching lessons with their track context.', {
        query: z
            .string()
            .describe('Search term to match against track/lesson titles and descriptions'),
    }, async ({ query }) => {
        try {
            const manifest = await getManifest();
            const q = query.toLowerCase();
            const results = [];
            for (const track of manifest.tracks) {
                const trackMatch = track.title.toLowerCase().includes(q) ||
                    track.description.toLowerCase().includes(q);
                const matchedLessons = track.lessons.filter((l) => l.title.toLowerCase().includes(q));
                if (trackMatch || matchedLessons.length > 0) {
                    results.push({
                        track: {
                            id: track.id,
                            title: track.title,
                            description: track.description,
                        },
                        matchedLessons: matchedLessons.length > 0
                            ? matchedLessons
                            : trackMatch
                                ? track.lessons
                                : [],
                        trackMatch,
                    });
                }
            }
            if (results.length === 0) {
                return {
                    content: [
                        {
                            type: 'text',
                            text: `No academy content found for "${query}". Use dwlf_list_academy_tracks to browse all content.`,
                        },
                    ],
                };
            }
            return {
                content: [
                    { type: 'text', text: JSON.stringify(results, null, 2) },
                ],
            };
        }
        catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error searching academy: ${error instanceof Error ? error.message : String(error)}`,
                    },
                ],
                isError: true,
            };
        }
    });
}
//# sourceMappingURL=academy.js.map