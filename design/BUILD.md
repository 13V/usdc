# Divvy app build — contract for screen agents

We're building the real app at `public/app.html` (a dark Gen-Z SPA) to match the
design frames in `design/frames/*.dc.html`, wired to the existing Express API.
Foundation is done: `public/divvy.css` (tokens + components), `public/mascot.js`
(the locked mascot), `public/app.js` (runtime + helpers). Each screen is a module
in `public/screens/<name>.js`.

## Screen module contract
```js
window.Screens.<name> = {
  title: "...",
  async render(view, params) {  // view = the #view element; params = array from the hash
    view.innerHTML = `...`;      // build the screen with divvy.css classes
    // wire events, fetch data, etc.
  }
};
```
Routes are hash-based: `#/home`, `#/groups`, `#/group/<id>`, `#/new`,
`#/settle/<tripId>`, `#/collect/<billId>`, `#/activity`, `#/friends`,
`#/friend/<id>`, `#/recurring`, `#/you`, `#/customize`, `#/chat/<id>`,
`#/receipt/<sig>`. Navigate with `app.go("groups")` or `location.hash`.

## Helpers (window.app)
- `app.api.get(path)` / `app.api.post(path, body)` / `app.api.del(path)` — JSON, throws on !ok, auto-auth.
- `app.money(cents, kind, showSign)` → HTML. kind: 'pos'(blue) | 'neg'(coral) | 'settled'(mint) | ''. Big mono digits, lighter $/decimals.
- `app.avatar(person, size)` → HTML emoji-on-color avatar. person = {emoji?, color?, name, id}. size 'sm' optional. Falls back to deterministic color + initial.
- `app.mascot({size, mood, glow})` → mascot HTML. moods: happy·wave·sparkle·watching·worried·sleepy.
- `app.esc(str)`, `app.toast(msg)`, `app.sheet(html)` / `app.closeSheet()`, `app.go(name)`.
- `window.Auth` (auth.js): `.user`, `.onChange(fn)`, `.signInWithWallet()`, `.createWallet()`, `.signInWithPrivy()`, `.updateProfile({handle,emoji,color})`, `.signOut()`, `.authFetch`.

## Design rules (match the frames, use divvy.css)
- Dark canvas; **lowercase, dry voice**; money ALWAYS via `app.money()` (mono).
- Money rule: owed-to-you = blue (`pos`), you-owe = coral (`neg`), settled = mint.
- Emoji+color identity for every person/group via `app.avatar`.
- Use `.card`, `.receipt`, `.btn`/`.btn.ghost`/`.btn.coral`, `.pill`, `.chip`,
  `.input`, `.eyebrow`, `.row`, `.owebar`, `.state`, `.empty`, `.skeleton`,
  `.avatar(-stack)`, `.hero-amount`. Renamed nouns: a split/expense = a **tab**,
  pay = **chip in**, done = **square ✨**.
- Show the **mascot** on emotional/empty/settle moments (not every utility row).
- Loading = `.skeleton` rows. Empty = `.empty` block (mascot + title + hint + a primary button).
- Read your frame in `design/frames/` and match layout/colors/copy closely.

## API endpoint map
- **me / auth:** `GET /api/me`, `window.Auth` for sign-in + profile.
- **home/balances:** `GET /api/me/balances` → { net, owed[], owe[], byPerson[], byGroup[] } (inspect the real shape); IOUs: `GET/POST /api/ious`, `DELETE /api/ious/:id`.
- **groups (trips):** `GET /api/trips?mine=1`, `POST /api/trips {name,cluster,members:[{name,wallet?,userId?}]}`, `GET /api/trips/:idOrToken`.
- **group detail:** `GET /api/trips/:id` → {id,name,members[],expenses[],...}; `POST /api/trips/:id/expenses {title,amountCents,paidBy,participants[]}`; `DELETE /api/trips/:id/expenses/:eid`; `POST /api/trips/:id/members`; `POST /api/trips/:id/members/:mid/claim`.
- **new split:** add to a group → `POST /api/trips/:id/expenses`; standalone bill → `POST /api/bills {title,total,tipPercent,count|names|groupId}`; scan → `POST /api/scan {image}`; fx → `GET /api/fx/:from/:amount`.
- **settle / collect:** `POST /api/trips/:id/settle` → returns transfers each with a `url` (solana: pay URL) + `reference`; poll `POST /api/trips/:id/settle/verify`. Bills: `GET /api/bills/:id`, `POST /api/bills/:id/verify`.
- **activity:** `GET /api/activity`.
- **friends:** `GET /api/friends`.
- **recurring:** `GET /api/recurring`, `POST /api/recurring`, `DELETE /api/recurring/:id`.
- **chat:** `GET /api/trips/:id/messages?after=`, `POST /api/trips/:id/messages {text?,image?}` (send `X-Trip-Token` header via the trip's shareToken when known).

When the API doesn't return emoji/color yet, fall back to `app.avatar` defaults.
When signed out, show a friendly empty/sign-in state (mascot + a connect button calling `Auth.createWallet()`), never a crash.

## Verify
`npm run web` serves it; open `http://localhost:3000/app.html`. Each screen must
render signed-out (empty/sign-in state) without errors, and match its frame.
