# NoFrame — XAMPP + MySQL Version

This version connects the NoFrame clothing store to a MySQL database running through XAMPP.

## Folder structure

- `index.html` — entry point
- `html/index.html` — website page
- `css/style.css` — styles + Light/Dark theme
- `js/app.js` — website logic + MySQL API connection
- `data/catalog.js` — starter catalog data
- `api/config.php` — MySQL connection settings
- `api/api.php` — PHP API for loading/saving products, categories, users, orders and reviews
- `database/noframe.sql` — database/table/initial product data
- `images/` — product images

## Install in XAMPP

1. Install/start XAMPP.
2. Start **Apache** and **MySQL**.
3. Copy the complete `NoFrame_XAMPP` folder into:
   `C:\xampp\htdocs\NoFrame_XAMPP`
4. Open **phpMyAdmin** from XAMPP.
5. Choose **Import** and import:
   `database/noframe.sql`
6. Confirm that the database named `noframe` exists.
7. If your MySQL root account has a password, edit:
   `api/config.php`
   and change `$DB_PASS`.
8. Open:
   `http://localhost/NoFrame_XAMPP/`

Do NOT open `html/index.html` directly with `file://...`. Use the localhost URL so PHP can talk to MySQL.

## MySQL connection

Default XAMPP settings used by this project:

- Host: `127.0.0.1`
- Database: `noframe`
- User: `root`
- Password: empty

If you changed your XAMPP MySQL password, update `api/config.php`.

## Product data

You can still use `data/catalog.js` as the starter catalog, but once the SQL database is imported, the live website reads its product/category data from MySQL.

For normal manual management, use the website's **Admin Dashboard → Product Management** and **Category Management**.

The admin seed account is:

- Email: `admin@noframe.com`
- Password: `admin123`

The demo customer is:

- Email: `demo@noframe.com`
- Password: `demo123`

## LKR currency

Product prices are stored as LKR. The website formats prices as:

`Rs. 6,500`

The delivery charge and price filters are also handled as LKR in the current project.

## Live price synchronization

Product prices are now database-backed. The browser checks the MySQL API every **15 seconds** for price changes. Therefore, when a product price is changed through the admin interface and saved to MySQL, other open pages can receive the updated price automatically.

This is **live database price syncing**, not an external clothing-market price feed. Clothing stores do not have a universal public "real-time market price" API. If you later have a supplier/API that provides actual live product prices, that API can be connected separately.

## Light / Dark theme

Use the **Theme** selector in the top header:

- Light
- Dark

The selected theme is saved in the browser and remains after refresh.

## If the site says "Saved locally"

That normally means the PHP/MySQL API could not be reached. Check:

1. Apache is running.
2. MySQL is running.
3. `noframe` database was imported.
4. `api/config.php` has the correct MySQL password.
5. You opened the site using `http://localhost/...`, not by double-clicking the HTML file.

