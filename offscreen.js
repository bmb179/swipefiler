// Runs Tesseract in an offscreen document (service workers can't spawn Web Workers).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen" || msg.type !== "ocr") return;
  (async () => {
    const blob = await getImage(msg.id);
    if (!blob) return { ok: false, error: "no image" };
    const text = await SF_OCR.recognize(blob);
    return { ok: true, text };
  })()
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message || e) }));
  return true;
});
