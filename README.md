# HAPZO ERP + DPP

HAPZO runs a Vite-powered React workspace with a Node.js API and a local SQLite database. The browser includes commercial, manufacturing, finance, compliance and digital product passport workflows. The static demo uses the same React screens and sample records.

## Run locally

Install Node.js 24 or later. In the project folder, run

```powershell
npm ci
npm run dev
```

Open [HAPZO Local](http://127.0.0.1:5173/) to start at the dashboard. With no active company session, the local app opens the sample workspace and saves changes in this browser. Choose **Open company workspace** to sign in or set up the SQLite workspace and use Gemini. An existing company session opens its own dashboard directly.

Vite updates the React UI as you edit it, and the Node API runs on the same port. For the production build, run `npm start` or double-click **Start HAPZO.cmd** on Windows. Both use port 5173 by default. Press Ctrl+C in the terminal to stop the server. Set `HAPZO_PORT` before startup to select a different port.

The server saves company records and uploaded originals in `data/hapzo.sqlite`. **Settings & data → Open a separate sample company** creates a workspace with example records.

## Import a buyer purchase order

1. Sign in to [Google AI Studio](https://aistudio.google.com/apikey). Copy the key for your project or use **Create API key**. If the project is missing, use **Dashboard → Projects → Import projects**, then return to the keys page.
2. Sign in to the local ERP as an administrator. Open **Gemini Model API**, paste the key into **Gemini API key**, and click **Save API key**. HAPZO stores it in the local server’s ignored `.env` file. The model list shows the models available for the connected project.
3. Open **Commercial → Buyer orders → Create buyer PO**. Choose a file from your computer under **Original buyer PO**. With Gemini configured, HAPZO sends the selected PDF and extracted layout to Google and opens **Review extracted buyer PO**.
4. Check the buyer, PO number, currency, delivery date and each line's style, colour, size, quantity and price against the PDF. Choose the deliverable and select **Save PO and tech pack drafts**. The production route can be chosen now or later in **Buyer orders → Approve PO line**.

The server also accepts `HAPZO_GEMINI_API_KEY` or `GEMINI_API_KEY` at startup. Keep the key on the server. [Google's API key guide](https://ai.google.dev/gemini-api/docs/api-key)

The built-in PO number reader uses PDF text and local OCR. To select a SoMark OXR service, use **Settings → Buyer PO number recognition**.

## Build and preview

- `npm run build` uses Vite to bundle the React workspace into `build/` and embed the offline pilot in `HAPZO_Decaste_ERP_Pilot.html`.
- `npm run preview` serves the browser-only training workspace on port 5173. To use it alongside the Node workspace or reopen training records previously saved on port 4380, run `npm run preview -- --port 4380` and open [HAPZO Preview](http://127.0.0.1:4380/). Orders, uploaded files and workflow transactions are saved in this browser's IndexedDB. Under **Buyer orders → Import buyer PO from PDF**, select a training PDF or upload one from your computer. Review the fields and save the draft. Gemini and scanned-document AI extraction use the Node.js workspace. Netlify publishes the static build using `netlify.toml`.
- `npm test` runs the backend regression suite.
- `npm run backup` creates a local SQLite backup.

The React workspace and standalone pilot have separate entry points. The pilot retains its original browser storage. The Node app uses authenticated, company-scoped endpoints for records, PDF uploads, document reading and persistence.
