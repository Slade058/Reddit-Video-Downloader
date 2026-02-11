import express from 'express';
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

// User-Agent to look like a regular browser
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Normalize a Reddit URL to get the JSON endpoint
 */
function getJsonUrl(url) {
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
async function fetchRedditData(url) {
    const jsonUrl = getJsonUrl(url);
    const res = await fetch(jsonUrl, {
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
        },
    });

    if (!res.ok) {
        throw new Error(`Reddit API returned ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();

    // Reddit returns an array of listings
    const post = data?.[0]?.data?.children?.[0]?.data;
    if (!post) {
        throw new Error('Could not parse Reddit post data');
    }

    return post;
}

/**
 * Extract video and audio URLs from Reddit post data
 */
/**
 * Extract video and audio URLs from Reddit post data
 */
async function extractMediaUrls(post) {
    const media = post.secure_media?.reddit_video || post.media?.reddit_video;

    if (!media) {
        // Check if it's a crosspost
        if (post.crosspost_parent_list?.length > 0) {
            const crosspost = post.crosspost_parent_list[0];
            const crossMedia = crosspost.secure_media?.reddit_video || crosspost.media?.reddit_video;
            if (crossMedia) {
                return extractFromRedditVideo(crossMedia);
            }
        }
        throw new Error('Bu post bir Reddit video içermiyor. Sadece Reddit tarafından barındırılan videolar desteklenir (v.redd.it).');
    }

    return extractFromRedditVideo(media);
}

async function extractFromRedditVideo(redditVideo) {
    const videoUrl = redditVideo.fallback_url || redditVideo.scrubber_media_url;

    if (!videoUrl) {
        throw new Error('Video URL bulunamadı');
    }

    const baseVideo = videoUrl.split('?')[0];
    let audioCandidates = [];

    // Method 1: Try to parse DASH manifest if available
    if (redditVideo.dash_url) {
        try {
            console.log(`Fetching DASH manifest: ${redditVideo.dash_url}`);
            const res = await fetch(redditVideo.dash_url, { headers: { 'User-Agent': UA } });
            if (res.ok) {
                const text = await res.text();
                // Simple regex to find BaseURLs that look like audio
                const matches = text.match(/<BaseURL>(.*?)<\/BaseURL>/g);
                if (matches) {
                    const found = matches
                        .map(m => m.replace(/<\/?BaseURL>/g, ''))
                        .filter(u => u.toLowerCase().includes('audio'));

                    if (found.length > 0) {
                        console.log('Found audio in DASH manifest:', found);
                        // Convert relative URLs to absolute if needed, but Reddit usually gives full or filename
                        // If filename only, append to base path of dash_url
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
        audioCandidates = [
            baseVideo.replace(/DASH_\d+\.mp4/, 'DASH_AUDIO_128.mp4').replace(/DASH_\d+/, 'DASH_AUDIO_128'),
            baseVideo.replace(/DASH_\d+\.mp4/, 'DASH_AUDIO_64.mp4').replace(/DASH_\d+/, 'DASH_AUDIO_64'),
            baseVideo.replace(/DASH_\d+\.mp4/, 'DASH_audio.mp4').replace(/DASH_\d+/, 'DASH_audio'),
            baseVideo.replace(/DASH_\d+\.mp4/, 'audio.mp4').replace(/DASH_\d+/, 'audio'),
        ];
    }

    // Remove duplicates
    const uniqueAudio = [...new Set(audioCandidates)];

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
 * Download a file from URL to a local path
 */
async function downloadFile(url, filePath) {
    const res = await fetch(url, {
        headers: { 'User-Agent': UA },
    });

    if (!res.ok) {
        return false; // Audio might not exist for some videos
    }

    const fileStream = fs.createWriteStream(filePath);
    await pipeline(Readable.fromWeb(res.body), fileStream);
    return true;
}

/**
 * Merge video and audio using ffmpeg
 */
function mergeWithFfmpeg(videoPath, audioPath, outputPath) {
    return new Promise((resolve, reject) => {
        const args = [
            '-i', videoPath,
            '-i', audioPath,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-strict', 'experimental',
            '-y',
            outputPath,
        ];

        execFile('ffmpeg', args, { timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                reject(new Error(`ffmpeg error: ${error.message}`));
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
app.post('/api/info', async (req, res) => {
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
                headers: { 'User-Agent': UA },
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
    } catch (err) {
        console.error('Info error:', err);
        res.status(500).json({ error: err.message || 'Video bilgisi alınamadı' });
    }
});

/**
 * POST /api/download - Download and merge a Reddit video
 */
app.post('/api/download', async (req, res) => {
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
                headers: { 'User-Agent': UA },
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
        const safeTitle = (post.title || 'reddit-video')
            .replace(/[^a-zA-Z0-9\s\-_çğıöşüÇĞİÖŞÜ]/g, '')
            .replace(/\s+/g, '_')
            .substring(0, 80);

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

    } catch (err) {
        console.error('Download error:', err);
        cleanup(tmpDir);
        if (!res.headersSent) {
            res.status(500).json({ error: err.message || 'Video indirilemedi' });
        }
    }
});

function cleanup(dir) {
    try {
        fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
        // ignore cleanup errors
    }
}

app.listen(PORT, () => {
    console.log(`🚀 Reddit Video Downloader API running on http://localhost:${PORT}`);
});
