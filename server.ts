import express from 'express';
import type { Request, Response } from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// User-Agent and Headers to look like a regular browser
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';
const HEADERS = {
    'User-Agent': UA,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
};

interface RedditVideo {
    fallback_url?: string;
    scrubber_media_url?: string;
    dash_url?: string;
    duration?: number;
    height?: number;
    width?: number;
    is_gif?: boolean;
}

interface RedditPostData {
    title: string;
    subreddit_name_prefixed: string;
    author: string;
    thumbnail: string;
    ups: number;
    permalink: string;
    crosspost_parent_list?: Array<{
        secure_media?: { reddit_video?: RedditVideo };
        media?: { reddit_video?: RedditVideo };
    }>;
    secure_media?: { reddit_video?: RedditVideo };
    media?: { reddit_video?: RedditVideo };
    preview?: {
        images?: Array<{
            source?: { url?: string };
        }>;
    };
}

interface MediaInfo {
    videoUrl: string;
    audioCandidates: string[];
    duration?: number;
    height?: number;
    width?: number;
    isGif?: boolean;
}

/**
 * Convert text to a safe URL/filename slug, specifically handling Turkish characters
 */
function slugify(text: string): string {
    const trMap: { [key: string]: string } = {
        'ç': 'c', 'Ç': 'C', 'ğ': 'g', 'Ğ': 'G', 'ı': 'i', 'İ': 'I',
        'ö': 'o', 'Ö': 'O', 'ş': 's', 'Ş': 'S', 'ü': 'u', 'Ü': 'U'
    };
    return text.split('').map(c => trMap[c] || c).join('')
        .replace(/[^a-zA-Z0-9\s\-_]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .substring(0, 80);
}

/**
 * Normalize a Reddit URL to get the JSON endpoint
 */
function getJsonUrl(url: string): string {
    let clean = url.split('?')[0].replace(/\/$/, '');
    // Remove trailing slash and add .json
    if (!clean.endsWith('.json')) {
        clean += '.json';
    }
    return clean;
}

/**
 * Fetch Reddit post data from the JSON API
 */
async function fetchRedditData(url: string): Promise<RedditPostData> {
    const jsonUrl = getJsonUrl(url);
    console.log(`Fetching Reddit data: ${jsonUrl}`);
    
    const res = await fetch(jsonUrl, {
        headers: HEADERS,
    });

    if (!res.ok) {
        if (res.status === 403) {
            throw new Error('Reddit erişimi engelledi (403). Lütfen bir süre sonra tekrar deneyin.');
        }
        if (res.status === 429) {
            throw new Error('Çok fazla istek gönderildi (429). Lütfen bekleyin.');
        }
        throw new Error(`Reddit API hatası (${res.status}): ${res.statusText}`);
    }

    const data = await res.json() as any;
    
    // Reddit returns an array of listings for comments/posts, or a single listing for some other endpoints
    let post;
    if (Array.isArray(data)) {
        post = data[0]?.data?.children?.[0]?.data;
    } else {
        post = data?.data?.children?.[0]?.data;
    }

    if (!post) {
        console.error('Parsed Data:', JSON.stringify(data).slice(0, 500));
        throw new Error('Reddit post verisi ayrıştırılamadı. URL doğru mu?');
    }

    return post as RedditPostData;
}

async function extractFromRedditVideo(redditVideo: RedditVideo): Promise<MediaInfo> {
    const videoUrl = redditVideo.fallback_url || redditVideo.scrubber_media_url;

    if (!videoUrl) {
        throw new Error('Video URL bulunamadı');
    }

    const baseVideo = videoUrl.split('?')[0];
    let audioCandidates: string[] = [];

    // Method 1: Try to parse DASH manifest if available
    if (redditVideo.dash_url) {
        try {
            console.log(`Fetching DASH manifest: ${redditVideo.dash_url}`);
            const res = await fetch(redditVideo.dash_url, { headers: HEADERS });
            if (res.ok) {
                const text = await res.text();
                // Improved regex to find BaseURLs
                const matches = text.match(/<BaseURL>(.*?)<\/BaseURL>/g);
                if (matches) {
                    const found = matches
                        .map(m => m.replace(/<\/?BaseURL>/g, '').trim())
                        .filter(u => u.toLowerCase().includes('audio') || u.includes('AUDIO'));

                    if (found.length > 0) {
                        console.log('Found audio in DASH manifest:', found);
                        const baseUrl = redditVideo.dash_url.substring(0, redditVideo.dash_url.lastIndexOf('/') + 1);

                        found.forEach(f => {
                            if (f.startsWith('http')) audioCandidates.push(f);
                            else audioCandidates.push(baseUrl + f);
                        });
                    }
                }
            }
        } catch (e) {
            console.error('Error parsing DASH manifest:', e);
        }
    }

    // Method 2: Fallback to guessing if no audio found
    if (audioCandidates.length === 0) {
        console.log('Falling back to audio URL guessing');
        const baseUrl = baseVideo.substring(0, baseVideo.lastIndexOf('/') + 1);
        
        // Handle cases where baseVideo might be DASH_720.mp4 or just DASH_720
        const dashMatch = baseVideo.match(/DASH_(\d+)/);
        if (dashMatch) {
            audioCandidates = [
                `${baseUrl}DASH_AUDIO_128.mp4`,
                `${baseUrl}DASH_AUDIO_64.mp4`,
                `${baseUrl}DASH_audio.mp4`,
                `${baseUrl}audio.mp4`,
                baseVideo.replace(/DASH_\d+(\.mp4)?/, 'DASH_AUDIO_128.mp4'),
                baseVideo.replace(/DASH_\d+(\.mp4)?/, 'DASH_audio.mp4'),
            ];
        } else {
            audioCandidates = [
                baseVideo.replace(/\/[^/]+$/, '/DASH_AUDIO_128.mp4'),
                baseVideo.replace(/\/[^/]+$/, '/DASH_audio.mp4'),
            ];
        }
    }

    // Remove duplicates and clean up
    const uniqueAudio = [...new Set(audioCandidates)].map(u => u.split('?')[0]);

    return {
        videoUrl: baseVideo,
        audioCandidates: uniqueAudio,
        duration: redditVideo.duration,
        height: redditVideo.height,
        width: redditVideo.width,
        isGif: redditVideo.is_gif,
    };
}

/**
 * Extract video and audio URLs from Reddit post data
 */
async function extractMediaUrls(post: RedditPostData): Promise<MediaInfo> {
    const video = post.secure_media?.reddit_video || 
                  post.media?.reddit_video || 
                  (post as any).preview?.reddit_video_preview;

    if (video) {
        return extractFromRedditVideo(video);
    }

    // Check if it's a crosspost
    if (post.crosspost_parent_list && post.crosspost_parent_list.length > 0) {
        for (const crosspost of post.crosspost_parent_list) {
            const crossVideo = crosspost.secure_media?.reddit_video || 
                               crosspost.media?.reddit_video ||
                               (crosspost as any).preview?.reddit_video_preview;
            if (crossVideo) {
                return extractFromRedditVideo(crossVideo);
            }
        }
    }

    throw new Error('Bu post bir Reddit video içermiyor veya desteklenmeyen bir formatta. Sadece Reddit tarafından barındırılan videolar desteklenir.');
}

/**
 * Download a file from URL to a local path
 */
async function downloadFile(url: string, filePath: string): Promise<boolean> {
    try {
        const res = await fetch(url, {
            headers: HEADERS,
        });

        if (!res.ok || !res.body) {
            return false;
        }

        const fileStream = fs.createWriteStream(filePath);
        await pipeline(Readable.fromWeb(res.body as any), fileStream);
        return true;
    } catch (e) {
        console.error(`Download failed for ${url}:`, e);
        return false;
    }
}

/**
 * Merge video and audio using ffmpeg
 */
function mergeWithFfmpeg(videoPath: string, audioPath: string, outputPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', videoPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',
            '-strict', 'experimental',
            '-y',
            outputPath,
        ];

        execFile('ffmpeg', args, { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('FFmpeg Stderr:', stderr);
                reject(new Error(`FFmpeg birleştirme hatası: ${error.message}`));
            } else {
                resolve(outputPath);
            }
        });
    });
}

// ============== API ROUTES ==============

/**
 * GET /api/info - Get video info from a Reddit URL
 */
app.post('/api/info', async (req: Request, res: Response): Promise<any> => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL gerekli' });
        }

        // Validate it's a Reddit URL
        if (!url.includes('reddit.com') && !url.includes('redd.it')) {
            return res.status(400).json({ error: 'Geçerli bir Reddit URL\'si girin' });
        }

        // Handle short redd.it URLs by following redirect
        let finalUrl = url;
        if (url.includes('redd.it') && !url.includes('reddit.com')) {
            const redirectRes = await fetch(url, {
                headers: HEADERS,
                redirect: 'follow',
            });
            finalUrl = redirectRes.url;
        }

        const post = await fetchRedditData(finalUrl);
        const media = await extractMediaUrls(post);

        res.json({
            title: post.title,
            subreddit: post.subreddit_name_prefixed,
            author: post.author,
            thumbnail: post.thumbnail,
            preview: post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&'),
            upvotes: post.ups,
            duration: media.duration,
            width: media.width,
            height: media.height,
            isGif: media.isGif,
            permalink: `https://www.reddit.com${post.permalink}`,
        });
    } catch (err: any) {
        console.error('Info error:', err);
        res.status(500).json({ error: err.message || 'Video bilgisi alınamadı' });
    }
});

/**
 * POST /api/download - Download and merge a Reddit video
 */
app.post('/api/download', async (req: Request, res: Response): Promise<any> => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reddit-dl-'));
    const videoPath = path.join(tmpDir, 'video.mp4');
    const audioPath = path.join(tmpDir, 'audio.mp4');
    const outputPath = path.join(tmpDir, 'output.mp4');

    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL gerekli' });
        }

        // Handle short redd.it URLs
        let finalUrl = url;
        if (url.includes('redd.it') && !url.includes('reddit.com')) {
            const redirectRes = await fetch(url, {
                headers: HEADERS,
                redirect: 'follow',
            });
            finalUrl = redirectRes.url;
        }

        const post = await fetchRedditData(finalUrl);
        const media = await extractMediaUrls(post);

        // Download video
        const videoOk = await downloadFile(media.videoUrl, videoPath);
        if (!videoOk) {
            throw new Error('Video indirilemedi');
        }

        // Try downloading audio (iterate candidates)
        let audioSuccess = false;
        if (!media.isGif && media.audioCandidates) {
            for (const audioUrl of media.audioCandidates) {
                console.log(`Trying audio candidate: ${audioUrl}`);
                const ok = await downloadFile(audioUrl, audioPath);
                if (ok) {
                    console.log('Audio download successful!');
                    audioSuccess = true;
                    break;
                }
            }
        }

        let finalPath;
        if (audioSuccess) {
            // Merge video + audio
            console.log('Merging video and audio...');
            await mergeWithFfmpeg(videoPath, audioPath, outputPath);
            finalPath = outputPath;
        } else {
            // No audio (GIF or audio unavailable) — send video only
            console.log('No audio found or GIF, sending video only.');
            finalPath = videoPath;
        }

        // Generate a safe filename
        const safeTitle = slugify(post.title || 'reddit-video');

        console.log(`Sending video: ${safeTitle}.mp4 (Path: ${finalPath})`);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
        res.setHeader('Content-Length', fs.statSync(finalPath).size);

        const stream = fs.createReadStream(finalPath);
        stream.pipe(res);

        stream.on('end', () => {
            // Cleanup temp files
            cleanup(tmpDir);
        });

        stream.on('error', (err) => {
            console.error('Stream error:', err);
            cleanup(tmpDir);
        });

    } catch (err: any) {
        console.error('Download error:', err);
        cleanup(tmpDir);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || 'Video indirilemedi' });
        }
    }
});

function cleanup(dir: string) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        // ignore cleanup errors
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Reddit Video Downloader API (TS) running on http://localhost:${PORT}`);
});
