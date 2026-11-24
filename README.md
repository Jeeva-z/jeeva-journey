# Jeeva S U · Life Journey

A small Three.js game that tells my story: cricket, chess, college, Grootan Technologies and AI.
Plain static site (no build step). Open `index.html` through any static server.

## Clash of Clans clan card

The live clan card uses the Vercel function in `api/clan.js`. Set these server-side environment variables in the Vercel project (Project Settings → Environment Variables):

- `COC_API_KEY`: API key from the Clash of Clans developer portal. Keep it server-side.
- `COC_CLAN_TAG`: the clan tag, with or without the leading `#`.

The key must allow the public IP address used for outbound requests by the deployed function. Vercel deployments do not necessarily have a fixed outbound IP by default; if the portal requires a fixed IP, configure static egress for the project or route this function through a host with a fixed outbound IP, then allowlist that IP. After setting variables, redeploy. The endpoint caches successful responses for five minutes.

To run locally with Vercel's function runtime, use `vercel dev` after setting the same variables in a local `.env` file. `.env` files are ignored by Git.

Controls: WASD / arrows to move, E to interact.


Explore here ⬇️
https://jeevas-journey.vercel.app/
