# NoFrame organized website

## Folder structure
- `html/index.html` — HTML page
- `css/style.css` — CSS
- `js/app.js` — application JavaScript
- `data/catalog.js` — **edit this file to manage categories and products**
- `images/<category>/` — manually add product photos

## Add a product manually
1. Put the photo in the category folder, e.g. `images/mens-shirts/05.jpg`.
2. Open `data/catalog.js`.
3. Add a product object under the correct category:

```js
{title:'My New Shirt',price:59,stock:15,tags:['new'],images:['../images/mens-shirts/05.jpg']},
```

4. Refresh the website.

## Add a new category
Add an object to `STORE_CATEGORIES` and add a matching array in `STORE_PRODUCTS`. Also create an `images/<category-id>/` folder.

Note: the site uses browser storage. If an older version has already saved the NoFrame database in browser storage, clear that site's `noframe-db` storage or use a fresh browser profile to see newly seeded catalog data.
