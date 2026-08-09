# AGENTS.md

## Repo Boundary
- This repo is the Angular client only.
- The backend lives in the sibling repo at `../xleplusglue`.
- For parse/inference work, assume both repos matter.

## Init Process
- Start the backend stack from `../xleplusglue/Docker` with `docker compose up --build` before testing client flows.
- The client expects these local services:
  - `http://localhost:8080` Liger
  - `http://localhost:8081` GSWB
  - `http://localhost:8082` Vampire
  - `http://localhost:8083` Redis API
- If these are not running, the UI may load but parse/Vampire flows will not behave correctly.

## Verify
- Build the client with `npm run build`.
- Run client tests with `npm test`.
- For end-to-end changes, verify the sibling backend stack first, then the client.

## Repo-Specific Notes
- `src/app/data.service.ts` hardcodes the service URLs above.
- Angular CLI version is 16.1.3.
- Cytoscape CommonJS warnings during build are expected.
- `README.md` says `master` is deprecated; use the current branch instead.
