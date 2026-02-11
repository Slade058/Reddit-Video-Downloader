import { useState, useCallback } from 'react'
import './App.css'

interface VideoInfo {
  title: string
  subreddit: string
  author: string
  thumbnail: string
  preview?: string
  upvotes: number
  duration: number
  width: number
  height: number
  isGif: boolean
  permalink: string
}

function App() {
  const [url, setUrl] = useState('')
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatUpvotes = (count: number) => {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
    return count.toString()
  }

  const fetchInfo = useCallback(async () => {
    if (!url.trim()) return

    setError('')
    setVideoInfo(null)
    setSuccess(false)
    setLoading(true)

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })

      const text = await res.text()
      let data

      try {
        data = JSON.parse(text)
      } catch (e) {
        throw new Error(`Sunucu hatası (${res.status}): ${text.slice(0, 100) || 'Boş yanıt'}`)
      }

      if (!res.ok) {
        throw new Error(data.error || `Hata: ${res.statusText}`)
      }

      setVideoInfo(data)
    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'Bir hata oluştu'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [url])

  const handleDownload = useCallback(async () => {
    if (!url.trim()) return

    setError('')
    setSuccess(false)
    setDownloading(true)

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Video indirilemedi')
      }

      // Get filename from Content-Disposition header
      const disposition = res.headers.get('Content-Disposition')
      let filename = 'reddit-video.mp4'
      if (disposition) {
        const match = disposition.match(/filename="?(.+)"?/)
        if (match) filename = match[1]
      }

      // Download the blob
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)

      setSuccess(true)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Video indirilemedi'
      setError(message)
    } finally {
      setDownloading(false)
    }
  }, [url])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      fetchInfo()
    }
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text && (text.includes('reddit.com') || text.includes('redd.it'))) {
        setUrl(text)
      }
    } catch {
      // clipboard permission denied, ignore
    }
  }

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.244 13.373c.037.21.056.424.056.64 0 3.267-3.8 5.917-8.49 5.917S1.32 17.28 1.32 14.013c0-.216.019-.43.056-.64A1.786 1.786 0 0 1 .4 11.8c0-.988.8-1.788 1.788-1.788.477 0 .91.187 1.233.493 1.216-.878 2.896-1.443 4.757-1.51l.894-4.208a.308.308 0 0 1 .365-.243l2.954.628a1.264 1.264 0 1 1-.143.672l-2.64-.561-.8 3.76c1.835.077 3.49.646 4.69 1.516a1.778 1.778 0 0 1 1.224-.484c.988 0 1.788.8 1.788 1.788 0 .651-.35 1.22-.872 1.534zM8.5 13.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5zm6.526 2.198c-.076.076-.698.698-2.026.698s-1.95-.622-2.026-.698a.312.312 0 0 1 .442-.442c.012.012.536.516 1.584.516s1.572-.504 1.584-.516a.312.312 0 0 1 .442.442zM15.5 13.5a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5z" />
          </svg>
        </div>
        <h1>Reddit Video İndirici</h1>
        <p>Reddit videolarını sesli olarak kolayca indirin</p>
      </header>

      {/* Input Card */}
      <div className="input-card">
        <div className="input-group">
          <div className="url-input-wrapper">
            <input
              id="url-input"
              type="url"
              placeholder="Reddit video bağlantısını yapıştırın..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={handlePaste}
              disabled={loading || downloading}
            />
            <span className="input-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </span>
          </div>
          <button
            className="btn-fetch"
            onClick={fetchInfo}
            disabled={!url.trim() || loading || downloading}
            id="fetch-btn"
          >
            {loading ? (
              <div className="spinner" />
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                Getir
              </>
            )}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="error-message">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}
      </div>

      {/* Video Info Card */}
      {videoInfo && (
        <div className="video-card">
          {/* Preview Image */}
          <div className="video-preview">
            <img
              src={videoInfo.preview || videoInfo.thumbnail}
              alt={videoInfo.title}
              onError={(e) => {
                (e.target as HTMLImageElement).src = videoInfo.thumbnail
              }}
            />
            <div className="overlay" />
            {videoInfo.duration > 0 && (
              <span className="duration-badge">
                {formatDuration(videoInfo.duration)}
              </span>
            )}
            {videoInfo.height && (
              <span className="resolution-badge">
                {videoInfo.height}p
              </span>
            )}
          </div>

          {/* Details */}
          <div className="video-details">
            <h2 className="video-title">{videoInfo.title}</h2>

            <div className="video-meta">
              <div className="meta-item">
                <svg viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0z" />
                </svg>
                <span className="subreddit">{videoInfo.subreddit}</span>
              </div>
              <div className="meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
                u/{videoInfo.author}
              </div>
              <div className="meta-item">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 19V5M5 12l7-7 7 7" />
                </svg>
                {formatUpvotes(videoInfo.upvotes)}
              </div>
            </div>

            {/* Download Button */}
            <button
              className="btn-download"
              onClick={handleDownload}
              disabled={downloading}
              id="download-btn"
            >
              {downloading ? (
                <>
                  <div className="spinner" />
                  İndiriliyor...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  MP4 Olarak İndir
                </>
              )}
            </button>

            {/* Success Message */}
            {success && (
              <div className="success-message">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Video başarıyla indirildi!
              </div>
            )}
          </div>
        </div>
      )}

      {/* Features */}
      {!videoInfo && (
        <div className="features">
          <div className="feature-item">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7" />
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
              </svg>
            </div>
            <h3>Sesli Video</h3>
            <p>Video ve ses otomatik birleştirilir</p>
          </div>
          <div className="feature-item">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
              </svg>
            </div>
            <h3>Hızlı İndirme</h3>
            <p>Yüksek hızda video indirme</p>
          </div>
          <div className="feature-item">
            <div className="feature-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <h3>Güvenli</h3>
            <p>Kayıt veya giriş gerektirmez</p>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="footer">
        <p>Reddit Video İndirici &mdash; Reddit ile bağlantılı değildir</p>
      </footer>
    </div>
  )
}

export default App
