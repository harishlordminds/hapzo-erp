# Static Netlify preview

Run `npm ci` and `npm run build`, then publish `build/`. Netlify uses the settings in `netlify.toml`. The React preview includes synthetic records and three purchase orders. Each visitor can import a text PDF, review and save orders, and post workflow progress in their browser. Clearing site data resets their training workspace. For a shared workspace with SQLite and Gemini PDF import, use `npm start` and open [HAPZO Local](http://127.0.0.1:5173/).
