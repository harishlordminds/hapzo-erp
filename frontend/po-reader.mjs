import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { readPoPages } from '../src/po-text.mjs';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function readBuyerPdf(file, document) {
  const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()), useSystemFonts: true, isEvalSupported: false });
  const pdf = await loading.promise;
  try {
    return { ...await readPoPages(pdf, file.name), document, layoutMethod: 'Browser PDF text reader' };
  } finally { await loading.destroy(); }
}
