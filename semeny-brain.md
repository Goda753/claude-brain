# SE MENY — Project Brain
*AI context document for semeny.no — inject into every session working on this project*

---

## 1. Project Overview

**semeny.no** is a Norwegian restaurant discovery and food ordering platform. It aggregates 66,000+ restaurants across Norway and Europe (Sweden, Denmark, Germany, and more). Users browse by city or food category, view restaurant menus, and place orders online. Restaurants sign up through a self-serve flow and manage their own menus, categories, and orders via an admin panel. There is also a custom Android-based kiosk POS app for in-restaurant ordering.

**Primary audiences:**
- End users: Norwegian and European diners browsing and ordering food
- Restaurant owners: managing menus, orders, and settings
- Platform admins: managing all restaurants, content, and platform-level settings
- POS operators: kiosk screen at restaurant counters

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Framework | Laravel 13 (PHP 8.5) |
| Frontend | Blade templates, Alpine.js, Livewire |
| CSS | Custom CSS + Argon Design System + Luxe template module |
| Payments | Vipps (primary Norwegian mobile pay), Stripe, cash on delivery |
| Delivery | Wolt integration (`WoltService.php`) |
| SMS | Sveve (Norwegian), Twilio (international) |
| POS | Custom Android kiosk app at `/public/pos/` |
| Accounting | Fiken integration (Norwegian accounting SaaS) |
| Error tracking | Sentry |
| Hosting | cPanel shared hosting at ProISP (proisp.no) |
| PHP binary | `/opt/alt/php85/usr/bin/php` (non-standard path — always use this for artisan) |

---

## 3. Server Access

### SSH
```bash
# Connect
ssh -i ~/.ssh/semeny_rsa digitubv@semeny

# Direct (if alias not set up)
ssh -i ~/.ssh/semeny_rsa digitubv@46.250.221.18

# SSH config entry
Host semeny
    HostName 46.250.221.18
    User digitubv
    IdentityFile ~/.ssh/semeny_rsa
    StrictHostKeyChecking no
```

**Web root:** `/home/digitubv/public_html`

### Deploy a single file
```bash
scp -i ~/.ssh/semeny_rsa LOCAL_PATH digitubv@semeny:/home/digitubv/public_html/RELATIVE_PATH
```

### Run artisan commands
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "cd /home/digitubv/public_html && /opt/alt/php85/usr/bin/php artisan COMMAND"
```

### Clear all caches (run after every deploy)
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "cd /home/digitubv/public_html && /opt/alt/php85/usr/bin/php artisan view:clear && /opt/alt/php85/usr/bin/php artisan cache:clear && /opt/alt/php85/usr/bin/php artisan config:clear"
```

### Check Laravel logs
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "tail -50 /home/digitubv/public_html/storage/logs/laravel-$(date +%Y-%m-%d).log"
```

### cPanel API
- URL: `https://cpanel75.proisp.no:2083`
- User: `digitubv`
- Token: `9JHB5V9SO87CCGX840MVS43GHG81YOWX`
- Example: `curl -sk -H "Authorization: cpanel digitubv:9JHB5V9SO87CCGX840MVS43GHG81YOWX" "https://cpanel75.proisp.no:2083/execute/MySQL/list_databases"`

---

## 4. Database

- **Host:** `localhost` (on server)
- **Database:** `digitubv_taker`
- **User:** `digitubv_takeru`
- **Password:** `s$0.pmhPc}_E`

**Query via SSH tunnel:**
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "mysql -u digitubv_takeru -p's\$0.pmhPc}_E' digitubv_taker -e 'YOUR QUERY'"
```

### Key Tables / Models

| Model | Table | Notes |
|---|---|---|
| `App\Restorant` | `companies` | Main restaurant model — name is intentionally misspelled |
| `App\Items` | `items` | Menu items belonging to a restaurant |
| `App\Order` | `orders` | Customer orders |
| `App\Categories` | `categories` | Menu categories within a restaurant |

**Note:** The model is `Restorant` (not `Restaurant`) — this is a known intentional misspelling from the base codebase. Always use this spelling in code.

---

## 5. Key File Locations

| What | Local Path | Server Path |
|---|---|---|
| Controllers | `app/Http/Controllers/` | `.../public_html/app/Http/Controllers/` |
| Blade views | `resources/views/` | `.../public_html/resources/views/` |
| Routes | `routes/web.php` | `.../public_html/routes/web.php` |
| Luxe module | `modules/LuxeTemplate/` | `.../public_html/modules/LuxeTemplate/` |
| POS frontend | `public/pos/` | `.../public_html/public/pos/` |
| CSS overrides | `public/luxe/semeny-overrides.css` | same relative path |
| Admin CSS | `public/byadmin/smny-front.css` | same relative path |
| Laravel logs | — | `/home/digitubv/public_html/storage/logs/laravel-YYYY-MM-DD.log` |
| .env | — | `/home/digitubv/public_html/.env` |
| Uploads | — | `/home/digitubv/public_html/public/uploads/` (28GB, do not delete) |
| Sessions | — | `/home/digitubv/public_html/storage/framework/sessions/` |

---

## 6. URL Structure

| URL | Description |
|---|---|
| `/` | Homepage — city picker |
| `/city/{city}` | City restaurant listing (e.g. `/city/oslo`) |
| `/sted/{slug}` | Individual restaurant page (e.g. `/sted/egonprinsen`) |
| `/mat/{category}` | Food category browsing page |
| `/blog` | Norwegian food guides / blog |
| `/for-restauranter` | Restaurant owner marketing / signup landing page |
| `/pos` | POS kiosk interface |
| `/admin` | Admin panel (blocked from search engines via robots.txt) |

**International prefixes:** `/se/sted/`, `/dk/sted/`, `/de/sted/` etc. for Sweden, Denmark, Germany — these are intentional and serve the 66k+ European restaurant database.

---

## 7. Critical Paths — Must Never Break

1. **Checkout flow** — cart → order creation → payment (Vipps/Stripe/cash) → confirmation
2. **Vipps payment** — primary Norwegian payment method, most used
3. **Order status updates** — restaurant receives and updates order status
4. **Restaurant page rendering** — `/sted/{slug}` via LuxeTemplate module
5. **Menu item display** — items and categories must render correctly
6. **POS kiosk** — `/public/pos/` must function independently (standalone SPA)
7. **Wolt delivery** — `WoltService.php` integration for delivery routing

If any of these break, prioritize fixing them above everything else.

---

## 8. Order Flow

1. User visits `/sted/{slug}` → restaurant menu loads via LuxeTemplate module
2. User adds items to cart (Alpine.js / Livewire handles state)
3. User proceeds to checkout → selects delivery/pickup + payment method
4. Payment:
   - **Vipps:** redirect to Vipps, callback confirms payment
   - **Stripe:** card payment inline
   - **Cash:** order placed immediately
5. Order record created in `orders` table → restaurant notified (SMS via Sveve/Twilio)
6. Restaurant accepts/updates order status via admin panel
7. If delivery via Wolt: `WoltService.php` dispatches delivery request
8. Fiken integration logs the transaction for accounting

---

## 9. Common Tasks

### Deploy a file and clear caches
```bash
scp -i ~/.ssh/semeny_rsa app/Http/Controllers/SomeController.php digitubv@semeny:/home/digitubv/public_html/app/Http/Controllers/SomeController.php
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "cd /home/digitubv/public_html && /opt/alt/php85/usr/bin/php artisan view:clear && /opt/alt/php85/usr/bin/php artisan cache:clear && /opt/alt/php85/usr/bin/php artisan config:clear"
```

### Check if site is up (curl blocked by bot filter — use User-Agent)
```bash
curl -s -A "Mozilla/5.0 Chrome/120" -o /dev/null -w "%{http_code}" "https://semeny.no/"
# 200 = OK, 403 without UA = intentional (BlockBadBots middleware)
```

### Run a DB migration
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "cd /home/digitubv/public_html && /opt/alt/php85/usr/bin/php artisan migrate"
```

### Check disk usage (quota ~43GB, keep under 35GB)
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "du -sh /home/digitubv/"
```

### Fix 403 errors caused by full disk (sessions fail)
```bash
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "find /home/digitubv/public_html/storage/framework/sessions/ -type f -delete"
ssh -i ~/.ssh/semeny_rsa digitubv@semeny "> /home/digitubv/public_html/storage/logs/laravel-$(date +%Y-%m-%d).log"
```

---

## 10. Known Quirks and Gotchas

- **Model spelling:** `App\Restorant` not `App\Restaurant` — do not "fix" this, it's intentional from the base package
- **PHP binary:** Always use `/opt/alt/php85/usr/bin/php` — the system `php` on the server may point to an older version
- **Bot filter:** `BlockBadBots` middleware blocks requests without a browser User-Agent — always add `-A "Mozilla/5.0 ..."` to curl commands testing the live site
- **Disk quota:** Uploads at `/public/uploads/` are 28GB — never delete them. cPanel backups land in the web root by default — move them to `~/backups/`
- **Session 403:** If disk quota fills up, sessions can't write and the site returns 403 for all users. Fix: clear sessions and truncate log file (see Common Tasks)
- **LuxeTemplate module:** Restaurant pages are rendered through `modules/LuxeTemplate/` — this is a separate module with its own views, not in the main `resources/views/`
- **Sitemaps:** Multiple sitemap files exist — `sitemap-restaurants-1.xml` and `sitemap-restaurants-2.xml` cover all restaurant pages. International URLs (`/se/`, `/dk/`, `/de/`) are intentional, not errors
- **cPanel API:** Use direct IP `cpanel75.proisp.no` not a domain alias for API calls
- **Artisan must be run from web root:** Always `cd /home/digitubv/public_html` before running artisan, or use `&&` on the server shell

---

## 11. Internationalization

- Primary language: **Norwegian (Bokmål)**
- Platform serves restaurants in: Norway, Sweden (`/se/`), Denmark (`/dk/`), Germany (`/de/`), and more European countries
- URL prefix convention: `/se/sted/`, `/dk/sted/`, `/de/sted/` for international restaurant pages
- SMS: Sveve for Norwegian numbers, Twilio for international
- 66,000+ restaurants total across all countries
- Blog content is Norwegian-language food guides

---

## 12. Testing Approach

1. **Local changes:** Edit files locally, verify PHP syntax before deploy
2. **Deploy:** SCP the changed file(s) to server
3. **Cache clear:** Always run view/cache/config clear after deploy
4. **Verify:** Use `curl -s -A "Mozilla/5.0 Chrome/120" https://semeny.no/PAGE` to confirm page loads (HTTP 200)
5. **Check logs:** `tail -50` on the Laravel log if something looks wrong
6. **Payments:** Test Vipps and Stripe in their respective sandbox/test modes before any payment-related changes go live
7. **Sentry:** Check Sentry dashboard for errors surfaced after a deploy

---

## 13. Sitemap Structure

| File | Contents |
|---|---|
| `sitemap.xml` | Index pointing to all sub-sitemaps |
| `sitemap-main.xml` | Core pages + 100+ blog posts + 400+ city pages |
| `sitemap-restaurants-1.xml` | Restaurant pages batch 1 |
| `sitemap-restaurants-2.xml` | Restaurant pages batch 2 |
| `sitemap-cuisine.xml` | 1,024 food category pages |
| `sitemap-images.xml` | Image sitemap |
