# swipefiler

A Chrome extension (Manifest V3) for marketers. It catches display ads as you browse, lets you snip any post (Alt+Shift+S or right-click → "Snip this post"), and you swipe to keep or toss each one. Kept ads are saved as PNG files, each with a .txt file holding the ad's text (read on-device with OCR), in Downloads/Swipefiler/.

## Install (Load unpacked)
1. Download or clone this repo.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repo folder.

## Privacy
Everything stays on your computer. Captures are kept in the browser's local storage, and text is read on-device by a bundled copy of Tesseract. Nothing is uploaded and there are no analytics.

## Third-party
`vendor/` contains Tesseract.js 5.1.1 and tesseract.js-core 5.1.1 (Apache-2.0, licenses included in `vendor/`) and the English `eng.traineddata` model from tessdata (Apache-2.0).
