# Credixa Studio

Credixa Studio is a resume-centered career assistant. The frontend is in `frontend/`; the Node.js backend and account API are in `backend/`. It extracts a resume locally, asks a selected LLM for an ATS-style review, applies user-requested edits without intentionally adding facts, searches the web for current job posts, and ranks those posts against the resume and optional preferences. It also calculates a local SHA-256 fingerprint and can anchor that fingerprint to an EVM blockchain.

## Run locally

Requirements: Node.js 18 or later. No npm packages are required.

```powershell
npm start
```

Open <http://localhost:3000> in your browser. The signed-in user dashboard is at <http://localhost:3000/dashboard>. Do not open `frontend/index.html` directly as a `file://` URL: the login, saved accounts, and API calls require the backend server.

## Connect providers

Open **Settings** and optionally add:

- An API key for OpenAI, Anthropic, or Google Gemini.
- A Tavily Search API key for current web search results.
- Optionally, a deployed `ResumeRegistry` contract address for on-chain anchoring.

Without an LLM key, Credixa performs a transparent local heuristic review and conservative heading cleanup so the demo still works. Without Tavily, it searches the public Remotive remote-job feed and ranks results locally; if that feed is unavailable, it shows clearly labeled example jobs instead of pretending they are live vacancies. Remotive asks API users to link to the original posting and identify Remotive as the source; Credixa does both. The public feed can be delayed by up to 24 hours.

The first job search is restricted to openings located in India. If the user later enters another location in the refinement form, that location becomes the filter; leaving it blank keeps India selected. If no India-eligible postings are available in the public feed, the app shows no live matches instead of widening the location silently.

The project does not bundle or train an LLM. Provider and search usage can be billed by those services. Keys are held in browser `sessionStorage` for the tab and passed to the local backend only when a request runs; the server does not persist API keys. The resume file is parsed in-browser. Account resume text and review data are encrypted with AES-256-GCM before being written to `backend/data/users.json`; passwords are stored as scrypt hashes. Session cookies are HTTP-only and sessions expire after seven days (sessions are cleared when the server restarts). Search results are public web results; confirm that each employer listing is still open.

For local development the app creates a random encryption secret at `backend/data/.app-secret`. Keep this file backed up with account data or saved profiles will no longer decrypt. For a deployment, set a stable secret before starting the server, for example in PowerShell:

```powershell
$env:APP_SECRET = "a-long-random-secret-kept-outside-the-repository"
npm start
```

Do not change the secret after accounts have saved data. Never commit `backend/data/` or a production secret. Account creation requires a valid email and a password of at least 12 characters. Email verification, password reset, account deletion, and account recovery are not implemented yet.

## Blockchain setup

1. Deploy [`contracts/ResumeRegistry.sol`](contracts/ResumeRegistry.sol) to an EVM network using Remix or your preferred Solidity toolchain.
2. Connect the browser wallet to that same network.
3. Add the deployed contract address in Settings.
4. Upload the exact resume file and choose **Anchor on blockchain**. The wallet will ask the user to approve a transaction and pay network gas.
5. Keep the file unchanged to verify the fingerprint later with **Check on-chain**. Any content or file-format change creates a different fingerprint.

The contract stores only the SHA-256 fingerprint, registering wallet address, and timestamp. It does not store the resume itself. Deploying the contract and making a transaction require a wallet and network funds; the app does not claim that the resume is confidential merely because its fingerprint is on-chain.

## Current boundaries

- The ATS score is an AI estimate based on common resume practices; real applicant tracking systems differ.
- Scanned PDFs need OCR before upload; this app extracts selectable PDF text.
- Resume edits are drafts. Review every factual detail before downloading or applying.
- Job results depend on search-index coverage and may be expired, duplicated, or incomplete; every result links to its source.
- This is a local MVP with account authentication and encrypted profile storage, not a hardened hosted service. The server binds to `127.0.0.1`. Before public deployment, use HTTPS, a production database, a managed secret store, robust rate limiting, email verification and password recovery, monitoring, backups, and an appropriate privacy/data-retention policy.
