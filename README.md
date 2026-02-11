# Reddit Video Downloader

A modern, fast, and user-friendly Reddit video downloader application. It allows you to download Reddit videos with audio (by automatically merging video and audio streams).

## 🌟 Features

- **Audio Support:** Automatically merges Reddit's separate video and audio streams.
- **High Quality:** Downloads videos in the highest available resolution.
- **Premium UI:** Modern Dark Mode design with glassmorphism effects.
- **User Friendly:** Just paste the link and download. No registration required.
- **Video Preview:** View video details like title, duration, and quality before downloading.

## 🚀 How It Works

Reddit serves videos (DASH video) and audio (DASH audio) as separate streams. This project solves this technical challenge by:

1.  **Backend (Express.js):**
    *   Fetches video metadata from the Reddit API.
    *   Temporarily downloads video and audio streams to the server.
    *   Uses **FFmpeg** to merge video and audio into a single `.mp4` file.
    *   Streams the ready-to-watch file back to the browser.

2.  **Frontend (React + Vite):**
    *   Takes the link from the user and sends it to the backend.
    *   Manages the download process and error states.
    *   Provides a sleek and responsive interface.

## 🛠️ Tech Stack

- **Frontend:** React, Vite, TypeScript, CSS3 (Variables, Animations)
- **Backend:** Node.js, Express
- **Video Processing:** FFmpeg, fluent-ffmpeg
- **Others:** Cors, Concurrently

## 📦 Installation

Follow these steps to run the project locally.

### Prerequisites

- Node.js (v16 or higher)
- **FFmpeg** (Must be installed on your system and added to PATH)

### Steps

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/username/reddit-video-downloader.git
    cd reddit-video-downloader
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Start the application:**
    Run both backend and frontend servers with a single command:
    ```bash
    npm run dev
    ```

4.  **Open in browser:**
    Navigate to `http://localhost:5173`

## 📝 Usage

1.  Copy the link of a video post from the Reddit app or website.
2.  Paste it into the input field in the application.
3.  Click the **"Fetch"** button to view video details.
4.  Click the **"Download MP4"** button.
5.  The video will validly download to your device once processing is complete.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.
