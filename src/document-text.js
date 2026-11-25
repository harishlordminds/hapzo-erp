import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createWorker, PSM } from 'tesseract.js';
import english from '@tesseract.js-data/eng';

const require = createRequire(import.meta.url);
const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const pdfAssets = dir => join(pdfRoot, dir).replaceAll('\\', '/') + '/';
const linearText = items => items.map(x => (x.str || '') + (x.hasEOL ? '\n' : ' ')).join('');

export function positionText(items) {
  const words = items.filter(item => item.str?.trim()).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  const lines = [];
  for (const word of words) {
    const y = word.transform[5];
    if (!lines.length || lines.at(-1).y - y > 3) lines.push({ y, items: [] });
    lines.at(-1).items.push(word);
  }
  return lines.map(line => {
    let right = null;
    let text = '';
    for (const word of line.items.sort((a, b) => a.transform[4] - b.transform[4])) {
      const x = word.transform[4];
      if (right != null) text += x - right > 14 ? '\t' : ' ';
      text += word.str.trim();
      right = x + word.width;
    }
    return text;
  }).join('\n');
}

function ocrRows(blocks) {
  // Sparse recognition returns separate fields. Align them before reading a label and its value.
  const words = (blocks ?? []).flatMap(block => block.paragraphs.flatMap(paragraph => paragraph.lines.flatMap(line => line.words)))
    .filter(word => word.text.trim()).map(({ text, confidence, bbox }) => ({
      text, confidence, left: bbox.x0, right: bbox.x1, y: (bbox.y0 + bbox.y1) / 2, height: bbox.y1 - bbox.y0,
    })).sort((a, b) => a.y - b.y || a.left - b.left);
  const rows = [];
  for (const word of words) {
    const last = rows.at(-1);
    if (!last || word.y - last.y > Math.max(3, 0.45 * Math.min(last.height, word.height))) {
      rows.push({ y: word.y, height: word.height, words: [] });
    }
    rows.at(-1).words.push(word);
  }
  return rows.map(row => {
    const cells = [];
    let edge = null;
    for (const word of row.words.sort((a, b) => a.left - b.left)) {
      if (edge == null || word.left - edge > Math.max(12, row.height)) cells.push([]);
      cells.at(-1).push(word);
      edge = word.right;
    }
    return cells.map(cell => ({ text: cell.map(word => word.text).join(' '), confidence: Math.round(Math.min(...cell.map(word => word.confidence))) }));
  });
}

async function recognizeHeader(worker, bytes) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const image = await loadImage(bytes);
  const height = Math.ceil(image.height * 0.33);
  const scale = Math.min(3, 3400 / image.width, 1900 / height);
  const canvas = createCanvas(Math.ceil(image.width * scale), Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.filter = 'grayscale(100%)';
  ctx.drawImage(image, 0, 0, image.width, height, 0, 0, canvas.width, canvas.height);
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  try {
    const { data } = await worker.recognize(canvas.toBuffer('image/png'), {}, { text: true, blocks: true });
    return { text: data.text, confidence: Math.round(data.confidence), rows: ocrRows(data.blocks) };
  } finally {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  }
}

export async function readDocumentPages(doc, { formatText = linearText, needsOcr = text => text.trim().length < 60, refineOcr } = {}) {
  let worker;
  async function recognize(bytes, page) {
    worker ??= await createWorker('eng', 1, { langPath: english.langPath, gzip: english.gzip, cacheMethod: 'none' });
    const { text, confidence } = (await worker.recognize(bytes)).data;
    const base = { page, text, confidence: Math.round(confidence), method: 'OCR' };
    if (!refineOcr?.(base)) return [base];
    try { return [base, { ...base, ...await recognizeHeader(worker, bytes) }]; }
    catch { return [base]; }
  }
  let task;
  try {
    if (doc.mime !== 'application/pdf') return await recognize(doc.bytes, 1);
    const pdf = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { createCanvas } = await import('@napi-rs/canvas');
    task = pdf.getDocument({
      data: new Uint8Array(doc.bytes), isEvalSupported: false, useSystemFonts: true, disableFontFace: true,
      cMapUrl: pdfAssets('cmaps'), cMapPacked: true, standardFontDataUrl: pdfAssets('standard_fonts'),
      wasmUrl: pdfAssets('wasm'), useWorkerFetch: false, maxImageSize: 20_000_000,
    });
    const document = await task.promise;
    const output = [];
    for (let i = 1; i <= document.numPages; i++) {
      const page = await document.getPage(i);
      const content = await page.getTextContent();
      const text = formatText(content.items);
      if (needsOcr(text, i)) {
        const size = page.getViewport({ scale: 1 });
        const scale = Math.min(2.6, 2200 / Math.max(size.width, size.height));
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
        output.push(...await recognize(canvas.toBuffer('image/png'), i));
      } else output.push({ page: i, text, method: 'PDF text' });
      page.cleanup();
    }
    return output;
  } finally {
    try { if (task) await task.destroy(); } finally { if (worker) await worker.terminate(); }
  }
}
