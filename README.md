# Comparing Product Prices Across Indian E-Commerce Sites with a Browser Agent

A practical guide to using an AI browser agent (Claude + Playwright) to pull the
**live price of a single product across multiple Indian online stores** and decide
which one is cheapest.

The running example is the **Sony WH-1000XM5** wireless headphones, compared across
**Amazon.in**, **Reliance Digital**, **Vijay Sales**, and **Tata CLiQ**. The same
approach works for any product and any set of stores.

The interesting part isn't the happy path — it's that **every site fought back in a
different way**. This guide documents each obstacle and the exact fix, so you can
reuse the patterns instead of rediscovering them.

> 📦 Comes with a **runnable script** — see [Run it](#run-it-the-included-script).
> ⚖️ Licensed [MIT](LICENSE).

---

## TL;DR — the result

| Store | Price (Sony WH-1000XM5) | Notes |
|---|---:|---|
| 🥇 **Tata CLiQ** | **₹26,999** | Cheapest; coupon price can go lower |
| Amazon.in | ₹27,627 | Lowest *genuine, non-sponsored* listing |
| Vijay Sales | ₹27,990 | — |
| Reliance Digital | ₹31,990 | Most expensive |

> Prices are illustrative (captured mid-2026) and change constantly. The value of
> this guide is the **method and the fixes**, not these exact numbers.

---

## The goal

> "Find the current price of the Sony WH-1000XM5 on four stores. Visit each site,
> handle whatever search box or layout they have, ignore accessories and the earbuds
> version, and tell me which store is cheapest."

Sounds trivial. In practice you hit four classes of problem:

1. **Search that doesn't work the obvious way** (wrong URL, hidden boxes).
2. **Result pages full of the wrong product** (ads, accessories, look-alikes).
3. **Prices that are hard to read cleanly** (mashed-together strings, EMI/coupon noise).
4. **Demos that *look* wrong even when the data is right** (ads on screen).

Below is each site, the obstacle, and the fix.

---

## Issue 1 — Amazon.in: sponsored ads and look-alike products

### What went wrong
- The **top of the search results was full of sponsored "Noise" brand ads**, not Sony.
  On screen it looked like the agent had searched for the wrong thing.
- The results also mixed in products that are *not* the target:
  - **Sony WF-1000XM5** — the **earbuds** (note `WF`, not `WH`), often cheaper, so a
    naive "lowest price" pick grabs the wrong product.
  - **Sony WH-1000XM6** — the newer model.
  - A **₹1,900 hinge-repair accessory** for the XM5.

### The fix
1. **Filter by the exact model string in code**, not by eye. Keep `WH-1000XM5`,
   explicitly *exclude* `WF-1000XM5`, `XM6`, and accessory words
   (`repair`, `hinge`, `case`, `cushion`, `pad`).
2. For a clean demo, **don't stop on the cluttered results page** — find the genuine
   non-sponsored listing, grab its product link, and **open the product detail page
   directly** so the real Sony headphone (and price) is what's on screen.

```js
// Run in the page after searching amazon.in/s?k=Sony+WH-1000XM5
() => {
  const items = [...document.querySelectorAll('div[data-component-type="s-search-result"]')];
  return items.map(it => {
    const txt = it.innerText.replace(/\n+/g, ' ');
    const price = it.querySelector('.a-price .a-offscreen')?.innerText || '';
    return { txt: txt.slice(0, 120), price };
  }).filter(x =>
    /WH-?1000XM5/i.test(x.txt) &&
    !/WF-?1000XM5/i.test(x.txt) &&            // exclude the earbuds
    !/XM6|repair|hinge|case|cushion|pad/i.test(x.txt) // exclude newer model + accessories
  );
}
```

Then open the product page directly, e.g. `https://www.amazon.in/dp/B0BZP2H373`,
and read `#productTitle` + `.a-price .a-offscreen`.

> **Lesson:** On marketplaces, "the first result" and "the cheapest result" are both
> traps. Match the **exact model number** and land on the **product page**.

---

## Issue 2 — Reliance Digital: the obvious search URL 404s

### What went wrong
- The intuitive search URL **`/search?q=...` returns a 404** ("page was not found").

### The fix
- The working search path is **`/products?q=...`**. Reaching it via the homepage
  search box also redirects there:

```
https://www.reliancedigital.in/products?q=Sony%20WH-1000XM5
```

- Results render via JavaScript, so **wait ~3s** before scraping. Then walk up from the
  product link to the nearest ancestor containing a `₹` price.

```js
() => {
  const a = [...document.querySelectorAll('a')]
    .find(a => /WH-?1000XM5/i.test(a.innerText || '') && !/WF-?1000XM5/i.test(a.innerText || ''));
  let card = a;
  for (let i = 0; i < 6 && card; i++) { if (/₹/.test(card.innerText)) break; card = card.parentElement; }
  const prices = (card?.innerText.match(/₹[\d,]+/g)) || [];
  return { prices, href: a?.href };
}
```

> **Lesson:** When a search URL 404s, **don't give up — use the on-site search box
> once to discover the real query-path**, then reuse that path directly.

---

## Issue 3 — Vijay Sales: the visible search box is a decoy

### What went wrong
- The search box you can see on the homepage is **`readonly`** — typing into it does
  nothing ("element is not editable").
- The page actually contains **multiple search inputs**; the visible one is a dummy and
  the **real editable input is hidden (zero-size) until you click the decoy**.
- The guessed search URL `/search/<slug>` also **404s**.

### The fix
1. **Click the visible `readonly` box** — this reveals the real editable input
   (it becomes visible and loses `readonly`).
2. Type into the **newly-revealed** input and submit.
3. The real results path is **`/search-listing?q=...`**, which you can then hit directly.

```js
// Diagnose which input is actually usable
() => [...document.querySelectorAll('input[type="text"]')].map((i, idx) => {
  const r = i.getBoundingClientRect();
  return { idx, cls: i.className, readonly: i.readOnly, visible: r.width > 0 && r.height > 0 };
});
// Strategy: click the visible+readonly box, then type into the input that becomes visible+editable.
```

Direct results URL once known:

```
https://www.vijaysales.com/search-listing?q=Sony%20WH-1000XM5
```

> **Lesson:** "Element is not editable / not visible" usually means there's a **decoy
> input** and the real one appears after an interaction. Inspect *all* inputs and their
> `readOnly`/visibility before assuming the search is broken.

---

## Issue 4 — Tata CLiQ: search works, but prices are mashed together

### What went wrong
- Search itself is easy: `?searchCategory=all&text=...` works.
- But the **selling price and MRP run together** in the extracted text, e.g.
  `₹3499023` is really `₹34,990` (MRP) + `23%` (discount) with the separators stripped.
- The page also surfaces **EMI amounts and coupon prices** that can be mistaken for the
  main price.

### The fix
- Match only the **first clean `₹` price** as the selling price, and treat extra numbers
  (MRP, EMI, coupon) separately rather than `match`-ing everything blindly.

```js
() => {
  const a = [...document.querySelectorAll('a[href]')]
    .find(a => /WH-?1000XM5/i.test(a.innerText || '') && !/WF-?1000XM5/i.test(a.innerText || '') && /\/p-/.test(a.href));
  let card = a;
  for (let i = 0; i < 7 && card; i++) { if (/₹/.test(card.innerText)) break; card = card.parentElement; }
  const price = (card?.innerText.match(/₹\s?[\d,]+/) || [])[0] || ''; // FIRST price = selling price
  return { price, href: a?.href };
}
```

Working URLs:

```
Search:  https://www.tatacliq.com/search/?searchCategory=all&text=Sony%20WH-1000XM5
Product: https://www.tatacliq.com/<slug>/p-<id>
```

> **Lesson:** Don't grab *all* numbers on a product card. The **first ₹ value is usually
> the selling price**; MRP, EMI, and coupon figures are noise to be handled explicitly.

---

## Cross-cutting lessons (the reusable playbook)

These apply to almost any "scrape a price from a retail site" task:

1. **Match the exact model number, exclude look-alikes.**
   `WH` vs `WF` is one character and a totally different product. Always exclude the
   earbuds, the newer/older model, and accessories (`repair`, `case`, `pad`, …).

2. **Extract with small JavaScript queries, not giant page snapshots.**
   Pulling full accessibility snapshots of a heavy retail page is slow and can stall.
   Run a focused `querySelectorAll` + regex and return just `{title, price, href}`.

3. **Walk up from the product link to find its price.**
   Prices live in an ancestor "card". Climb a few parent levels until you hit a `₹`.

4. **When the obvious search URL fails, use the on-site box once to learn the real path** —
   then reuse that path directly on later runs.

5. **Inspect *all* inputs when a search box won't accept text.**
   Check `readOnly` and bounding-box size. A decoy input that reveals the real one on
   click is a common pattern.

6. **Wait for JS-rendered results** (~2–3s) before scraping SPA-style sites
   (Reliance, Vijay Sales, Tata CLiQ all render results client-side).

7. **For demos, land on the product detail page**, not the results page.
   Results pages are full of ads and look-alikes; the product page shows the *right*
   item and price clearly on screen.

8. **The first ₹ value is usually the selling price.**
   MRP, EMI/month, and coupon prices are extra — handle them explicitly, don't let them
   win a "minimum price" comparison.

---

## Quick reference: working URLs

| Store | Search URL pattern | Gotcha |
|---|---|---|
| Amazon.in | `amazon.in/s?k=<query>` | Sponsored ads + earbuds/newer-model look-alikes |
| Reliance Digital | `reliancedigital.in/products?q=<query>` | `/search?q=` **404s** — use `/products?q=` |
| Vijay Sales | `vijaysales.com/search-listing?q=<query>` | Visible search box is a **readonly decoy** |
| Tata CLiQ | `tatacliq.com/search/?searchCategory=all&text=<query>` | Prices **mashed together** in text |

---

## Run it: the included script

This repo ships a **runnable Playwright script** (`compare-prices.mjs`) that applies
every fix above and prints the cheapest store.

```bash
git clone https://github.com/nirmalmedicare/price-comparison-browser-agent-guide.git
cd price-comparison-browser-agent-guide

npm install                      # installs playwright
npx playwright install chromium  # one-time browser download

node compare-prices.mjs                 # defaults to "Sony WH-1000XM5"
node compare-prices.mjs "Sony WH-1000XM5"
HEADLESS=false node compare-prices.mjs  # watch the browser drive each site
```

Example output:

```
Comparing prices for: "Sony WH-1000XM5"
------------------------------------------------
Amazon.in            ₹27,627
Reliance Digital     ₹31,990
Vijay Sales          ₹27,990
Tata CLiQ            ₹26999
------------------------------------------------

🥇 Cheapest: Tata CLiQ at ₹26999
```

Each store's quirk is handled in its own function in `compare-prices.mjs`
(Reliance's `/products?q=` path, Vijay Sales' `/search-listing?q=`, Tata CLiQ's
first-₹-is-the-price rule, Amazon's earbuds/accessory filter), so the script doubles
as an executable version of this guide.

> Retail markup changes often. If a store prints `not found`, re-check that site's
> selector/URL section above — the **method** is the durable part, not any one selector.

## Or run it as an agent (no script)

1. Use **Claude Code** with the **Playwright MCP browser tools** enabled.
2. Give it a plain-English prompt like the goal above.
3. Let it **navigate, handle each site's quirk, extract prices, and compare** — keeping
   the browser visible so you can watch it adapt to each layout in real time.

No hardcoded selectors required — the agent discovers each site's quirks live. The
script above is what those discoveries look like once captured.

---

*Built with [Claude Code](https://claude.com/claude-code) driving a Playwright browser.*
