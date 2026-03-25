# Daily Growth Tracker

A simple web app to plan daily tasks, track progress, and keep everything synced per user with a lightweight backend. The UI runs in the browser; accounts and data are stored in SQLite (via [sql.js](https://sql.js.org/)) on the server.

## Features

- **Tasks per day** — add, complete, delete, and set time estimates  
- **Calendar** — pick any date to view or edit that day  
- **Progress** — visual progress bar and gentle completion celebration  
- **Auth** — register / sign in with email and password (JWT)  
- **Import / export** — CSV and a downloadable text report  
- **Preferences** — affirmations and dismissible time warnings (synced when signed in)

## Requirements

- [Node.js](https://nodejs.org/) **18+** (LTS recommended; **20+** or **22 LTS** avoids native SQLite build issues on some setups)

## Quick start (local)

1. **Clone or download** this repository.

2. **Install dependencies** (from the `server` folder):

   ```bash
   cd server
   npm install
   ```

3. **Environment variables** — copy the example file and edit the secret:

   ```bash
   cp .env.example .env
   ```

   Open `.env` and set a strong, random `JWT_SECRET` (never commit `.env` to Git).

4. **Start the server** (still inside `server`):

   ```bash
   npm start
   ```

5. **Open the app** in your browser:

   **http://localhost:3000**

   Use this URL (not `file://…`). The server serves both the static pages and the `/api` routes.

### Environment variables

| Variable       | Description                                      |
|----------------|--------------------------------------------------|
| `PORT`         | Server port (default: `3000` if unset)           |
| `JWT_SECRET`   | Secret for signing session tokens — **required** for production |

See `server/.env.example` for a template.

## Project layout

```
Growth Tracker/
├── index.html          # Main page
├── css/                # Styles
├── js/                 # Client scripts (app, API, auth, calendar)
├── server/
│   ├── server.js       # Express API + static file hosting
│   ├── db-sqljs.js     # SQLite (sql.js) + file persistence
│   ├── package.json
│   ├── .env.example
│   └── growth-tracker.db   # Created locally when you run the app (not in Git)
└── README.md
```

## Deploying (short note)

Host this as a **Node** web process with `cd server && npm install` and `cd server && npm start`. Set `JWT_SECRET` in your host’s environment. Free tiers often use **ephemeral disks**, so the SQLite file may reset on redeploy unless you add persistent storage or a managed database.

## License

No license is specified by default. Add a `LICENSE` file to the repository if you want to define how others may use the code.
