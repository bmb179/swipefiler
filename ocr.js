// Shared OCR helpers (used by offscreen.js; also loadable in a test page).
const SF_OCR = (() => {
  let workerPromise = null;
  const url = (p) =>
    typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(p) : p;

  function getWorker() {
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker("eng", 1, {
        workerPath: url("vendor/worker-shim.js"),
        corePath: url("vendor/core/"),
        langPath: url("vendor/lang/"),
        gzip: true,
        workerBlobURL: false,
        cacheMethod: "none"
      }).catch((e) => {
        workerPromise = null;
        throw e;
      });
    }
    return workerPromise;
  }

  // Upscale small crops ~2x (white background, smoothing on) for better accuracy.
  async function prepare(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.max(bmp.width, bmp.height) < 1200 ? 2 : 1;
    const pad = 16; // white margin so text touching the crop edge still reads
    const w = Math.round(bmp.width * scale) + pad * 2;
    const h = Math.round(bmp.height * scale) + pad * 2;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, pad, pad, w - pad * 2, h - pad * 2);
    bmp.close();
    return canvas.convertToBlob({ type: "image/png" });
  }

  function normalize(text) {
    return (text || "")
      .replace(/\r/g, "")
      .split("\n")
      .map((l) => l.replace(/[ \t\u00a0]+/g, " ").trim())
      .filter((l, i, a) => l || (i > 0 && a[i - 1]))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function recognize(blob) {
    const worker = await getWorker();
    const img = await prepare(blob);
    const { data } = await worker.recognize(img);
    return normalize(data.text);
  }

  return { recognize, normalize };
})();
