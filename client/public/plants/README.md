# Demo plant art

Art for the five demo plants, served by the client at `/plants/`. The committed
sprites were rendered from species-name prompts. The templates also name
optional photographs for the archive's specimen cards, but those photographs
are not checked in.

The committed sprites are pipeline renders — hand-made art never landed here,
which left every seeded avatar 404ing to a bare pot. Until someone draws them
by hand, regenerate them with the one generator that covers demo plants and
Thornback alike:

```
npm run sprites:generate -w server            # anything still missing
npm run sprites:generate -w server -- --force # re-render
```

Dropping in a hand-drawn `SPRITE_<Key>.png` simply replaces the render; the
generator skips files that already exist unless `--force` is passed.

| Plant | Sprite | Optional photo filename |
| --- | --- | --- |
| Helianthus annuus (sunflower) | `SPRITE_Helianthus.png` | `IMG_Helianthus.jpg` |
| Quercus robur (English oak) | `SPRITE_Quercus.png` | `IMG_Quercus.jpg` |
| Monstera deliciosa (swiss cheese plant) | `SPRITE_Monstera.png` | `IMG_Monstera.jpg` |
| Ficus lyrata (fiddle-leaf fig) | `SPRITE_Ficus.png` | `IMG_Ficus.jpg` |
| Amanita muscaria (fly agaric) | `SPRITE_Amanita.png` | `IMG_Amanita.jpg` |

The filenames are matched exactly, not guessed at. If a file you add uses a
different extension — or you swap in a different species for one of the five —
edit that template's `spriteFile` / `photoFile` in
`server/data/demo-avatar-templates.ts`, which is the only place they are named.

Hand-made sprites should be PNG with a transparent background so the pot shows
through behind the feet; 192×192 matches what the scan pipeline produces, and
the archive scales whatever it gets. A missing file is not fatal: the plant
renders as an empty pot, and the specimen card simply omits the photo.

The stats, species and habitat text for each plant live beside the filenames in
`demo-avatar-templates.ts` — art here, numbers there.

Thornback, the battle opponent, is not hand-made: it is rendered by
`npm run sprites:generate -w server` into `client/public/sprites/`.
