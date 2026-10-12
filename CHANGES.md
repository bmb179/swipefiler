# swipefiler 1.3.0 — what changed

## 1. Ads that were being skipped by mistake now get caught
The old filter ignored any page element whose name *contained* words like "content", "thread", "header" or "nav", so real ads named things like `ad-content` or `ad-container-thread` were silently missed.
Now:
- It looks at whole words in the name, so "headerbar" no longer counts as "header".
- If the name contains an ad word ("ad", "ads", "sponsored", "advertisement" and similar), it's treated as an ad even if it also says "content".
- Sure-fire ad signals (Google ad frames, AdSense slots, `div-gpt-ad...` slots, known ad-network frames) are always captured.
- Plain page sections like "main-content" or "nav-bar" are still skipped, same as before.

## 2. Every saved ad now keeps its text (OCR)
Each auto-captured ad and each manual snip is now read for text. The text is saved with the item.
- The image saves instantly. The text fills in a second or two later, so browsing isn't slowed down.
- The text reading runs entirely on your computer. Nothing is sent anywhere. The reading engine (Tesseract, open-source) ships inside the extension.
- Small ads are enlarged before reading, which makes the text more accurate.

## 3. Where you see the text
- **Review:** a small scrollable text box under each card ("Reading text…" while it works).
- **Kept ads (File tab):** click an ad and the text shows under the picture, with a **Copy text** button.
- **Downloads:** keeping an ad now saves a `.txt` next to the `.png` in Downloads/Swipefiler, with the same name. It holds the page title, the page address, when it was saved, and the ad text. Deleting a kept ad deletes both files.

## 4. Other
- Version is now 1.3.0.
- One new permission, "offscreen". It lets the extension run the text reader in the background. No new website access.
- The extension is now about 11 MB, up from about 30 KB, because the text reader and its English language file are bundled inside it.

## How to install
Unzip, open chrome://extensions, turn on Developer mode, click "Load unpacked" and pick the unzipped folder. If you had 1.2.0 loaded, remove it first or hit reload on it. Your saved ads stay.
