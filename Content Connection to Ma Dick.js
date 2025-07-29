// ==UserScript==
// @name         Content Connection to Ma Dick
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Auto-unpause and auto-advance for embedded audio content
// @match        https://resources.contentconnections.ca/*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    'use strict';

    const STEP = 0.05;
    const DEFAULT_RATE = 1.5;
    const AUTO_ADVANCE_BUFFER = 2.0; // seconds BEFORE end to trigger advance
    const MAX_RETRIES_WHEN_BLURRED = 5;

    let playbackRate = GM_getValue("mediaRate", DEFAULT_RATE);
    let cachedAudio = null;
    let cachedPlayButton = null;
    let userClickedPause = false;
    let isTabFocused = true;
    let retryCount = 0;
    let autoUnpauseEnabled = true;
    let autoAdvanceActive = false;
    let wasBlurredWhenPaused = false;
    let lastBlurState = false;

    const display = document.createElement('div');
    display.style.cssText = `position:fixed;top:10px;left:10px;padding:6px 12px;background:rgba(0,0,0,0.7);color:#fff;font-size:16px;font-family:sans-serif;border-radius:6px;z-index:9999;transition:opacity 0.5s ease;opacity:0;`;
    document.body.appendChild(display);

    function showDisplay(text) {
        display.textContent = text;
        display.style.opacity = '1';
        clearTimeout(display._hideTimer);
        display._hideTimer = setTimeout(() => display.style.opacity = '0', 2000);
    }

    function updatePlaybackRate(delta) {
        playbackRate = Math.max(0.25, Math.round((playbackRate + delta) * 100) / 100);
        GM_setValue("mediaRate", playbackRate);
        applyPlaybackRate(window);
        showDisplay(`Playback: ${playbackRate.toFixed(2)}×`);
    }

    function applyPlaybackRate(frame) {
        try {
            const audios = frame.document.querySelectorAll('audio');
            const videos = frame.document.querySelectorAll('video');
            [...audios, ...videos].forEach(el => el.playbackRate = playbackRate);
            for (let i = 0; i < frame.frames.length; i++) {
                applyPlaybackRate(frame.frames[i]);
            }
        } catch (e) {}
    }

    function findAudioRecursive(frame, depth = 0) {
        try {
            if (!frame.document) return null;
            const audios = frame.document.querySelectorAll('audio');
            if (audios.length) {
                console.log(`[FindAudio] Found audio in frame level ${depth}`);
                return audios[0];
            }
            for (let i = 0; i < frame.frames.length; i++) {
                const found = findAudioRecursive(frame.frames[i], depth + 1);
                if (found) return found;
            }
        } catch (e) {}
        return null;
    }

    function simulatePlayClick() {
        if (!cachedPlayButton || !document.contains(cachedPlayButton)) {
            cachedPlayButton = document.querySelector('.mediaPlayer__playPause');
        }
        if (cachedPlayButton) {
            cachedPlayButton.click();
            console.log('[Recovery] Simulated click on play button');
        } else {
            console.log('[Recovery] Play button not found');
        }
    }

    function forceUnpauseUnlessUserPaused() {
        if (!autoUnpauseEnabled || autoAdvanceActive) return;

        const audio = cachedAudio;
        if (!audio || !audio.isConnected) return;

        const timeRemaining = audio.duration - audio.currentTime;
        if (timeRemaining < AUTO_ADVANCE_BUFFER) return;

        if (audio.paused && !userClickedPause) {
            if (!isTabFocused && !lastBlurState) {
                retryCount = 1;
                simulatePlayClick();
                lastBlurState = true;
            } else if (!isTabFocused && retryCount < MAX_RETRIES_WHEN_BLURRED) {
                retryCount++;
                simulatePlayClick();
            }
        } else {
            retryCount = 0;
            wasBlurredWhenPaused = false;
            lastBlurState = false;
        }
    }

    function setupAudioListeners() {
        if (!cachedAudio) return;

        cachedAudio.addEventListener('pause', () => {
            setTimeout(() => {
                if (!cachedAudio.paused) return;
                forceUnpauseUnlessUserPaused();
            }, 50);
        });

        cachedAudio.addEventListener('play', () => {
            userClickedPause = false;
        });

        setInterval(() => {
            if (!cachedAudio || cachedAudio.ended || autoAdvanceActive) return;
            const timeRemaining = cachedAudio.duration - cachedAudio.currentTime;
            if (timeRemaining < AUTO_ADVANCE_BUFFER) {
                autoAdvanceActive = true;
                console.log('[AutoAdvance] Pre-end triggered, will advance in 2s');
                setTimeout(() => {
                    const nextBtn = document.querySelector('.mediaPlayer__button--forward');
                    if (nextBtn) nextBtn.click();
                    autoAdvanceActive = false;
                }, 2000);
            }
        }, 1000);
    }

    function setupPlayButtonListener() {
        cachedPlayButton = document.querySelector('.mediaPlayer__playPause');
        if (cachedPlayButton) {
            cachedPlayButton.addEventListener('mousedown', () => {
                userClickedPause = true;
                console.log('[User] Manually paused via button');
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ') {
                userClickedPause = true;
                console.log('[User] Manually paused via spacebar');
            }
        });
    }

    function trackAudioAndPlayButton(frame) {
        try {
            const observer = new MutationObserver(() => {
                cachedAudio = findAudioRecursive(window);
                setupAudioListeners();
                setupPlayButtonListener();
            });
            observer.observe(frame.document.body || frame.document.documentElement, { childList: true, subtree: true });
            for (let i = 0; i < frame.frames.length; i++) {
                trackAudioAndPlayButton(frame.frames[i]);
            }
        } catch (e) {}
    }

    function setupVisibilityTracking() {
        document.addEventListener('visibilitychange', () => {
            isTabFocused = document.visibilityState === 'visible';
        });
        window.addEventListener('focus', () => isTabFocused = true);
        window.addEventListener('blur', () => isTabFocused = false);
    }

    window.addEventListener('load', () => {
        setTimeout(() => {
            setupVisibilityTracking();
            applyPlaybackRate(window);
            cachedAudio = findAudioRecursive(window);
            setupAudioListeners();
            setupPlayButtonListener();
            trackAudioAndPlayButton(window);
            setInterval(forceUnpauseUnlessUserPaused, 1000);

            window.addEventListener('keydown', (e) => {
                if (e.key === ']') updatePlaybackRate(STEP);
                if (e.key === '[') updatePlaybackRate(-STEP);
                if (e.key === 'u') {
                    autoUnpauseEnabled = !autoUnpauseEnabled;
                    showDisplay(`Auto-Unpause: ${autoUnpauseEnabled ? 'ENABLED' : 'DISABLED'}`);
                }
            });
        }, 1000);
    });
})();
