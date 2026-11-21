# Generated sprites

The client serves this folder at `/sprites/`. It holds the sprites that are
rendered by the pipeline rather than drawn by hand:

| File | Used by |
| --- | --- |
| `thornback.png` | the PVE opponent on the battle screen |

Generate it with an image-model key in `server/.env` — `FLUX_API_KEY` (or
`NVIDIA_API_KEY`) and/or `GEMINI_API_KEY`, ideally with `REMOVE_BG_API_KEY` for
a transparent cutout:

```
npm run sprites:generate -w server            # anything still missing
npm run sprites:generate -w server -- --force # re-render
```

The script refuses to write the pipeline's placeholder drawing, so a run
without a key fails loudly instead of committing art no model made.

A missing file is not fatal — `PlantVisuals` renders the empty pot on its own.

The demo plants live in `client/public/plants/`. Their committed sprites are
pipeline renders documented in that folder's [README](../plants/README.md).
Scanned plant sprites are stored in Cloud Storage, with their URLs on the avatar
records.
