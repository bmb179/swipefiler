// Tesseract worker wrapper: serves eng.traineddata.gz from the bundled base64 text chunks
// (vendor/lang/*.b64.*) instead of a binary file. No network access.
(() => {
  const realFetch = self.fetch.bind(self);
  const LANG_DIR = new URL("lang/", self.location.href).href;
  async function loadLang() {
    const manifest = await (await realFetch(LANG_DIR + "eng.manifest.json")).json();
    const parts = await Promise.all(
      manifest.chunks.map((c) => realFetch(LANG_DIR + c).then((r) => r.text()))
    );
    const bin = atob(parts.join("").replace(/\s+/g, ""));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  self.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url || String(input);
    if (/\/eng\.traineddata(\.gz)?$/.test(url)) {
      return loadLang().then((b) => new Response(b, { status: 200 }));
    }
    return realFetch(input, init);
  };
})();
importScripts("worker.min.js");
