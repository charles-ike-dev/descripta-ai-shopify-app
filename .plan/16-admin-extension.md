# 16: Write copy from the Shopify product page (admin extension)

**Effort:** M · **Depends on:** none (uses the shared helpers from 01)

## Why

Merchants edit products on Shopify's own product page, not inside the app. Having to leave that page, open Apps → Descripta and find the product again is a lot of friction. An admin extension puts "Write with Descripta" exactly where they are already working. It's also the kind of integration that stands out in a portfolio and on the App Store.

## What to build

1. **Admin action** (`admin.product-details.action.render`). It appears in the product page's "More actions" menu as "Write description with Descripta". It opens a modal that generates a draft, shows it, and has **Apply** and **Open in Descripta** buttons.
2. **Admin block** (`admin.product-details.block.render`). A small card on the product page showing the copy health score, its top issues and a "Generate" button.
3. Optionally, a **bulk action** (`admin.product-index.selection-action.render`) on the products list: "Write drafts with Descripta" for the selected products. It starts a job (plan 02) and links to the review queue (plan 01).

## Implementation

1. **Scaffold.** `npm run shopify app generate extension -- --template admin_action` and `--template admin_block`. They land in `extensions/`, which is already set up as a workspace in `package.json`. Use Preact and Polaris web components, as the current templates do.
2. **Backend calls.** Extensions call the app server with `fetch("/app/api/…")`. Shopify automatically adds a session token to requests to the app's own URL, and `authenticate.admin(request)` accepts it. Check the exact flow for extensions in the Shopify AI Toolkit.
3. **Endpoints.** Reuse `app/routes/app.api.drafts.tsx` to generate (it already returns JSON). Add `POST /app/api/drafts/:id/apply`, which calls `applyDraft` from plan 01, and `GET /app/api/health/:productId`, which returns `scoreCopy` for a single product.
4. **Modal UI.** It shows the current and new description (rendered as plain text, or as sanitised HTML in a preview area), the SEO title and meta description with character counts, and the Apply / Regenerate / Open in app buttons. Keep editing in the full app, because a modal is too small for a good HTML editor.
5. **After applying.** Call the extension API's `close()`. If the API has a way to refresh the host page, use it, so the product form shows the new description. Otherwise tell the merchant to reload.
6. **Deploy.** `npm run deploy` publishes extensions together with the app config.

## Edge cases

- The merchant has unsaved edits in Shopify's own product form. Applying through the API could be overwritten when they press Save. Warn them in the modal: "Save or discard your changes first."
- Quota exceeded (plan 08): show the upgrade message inside the modal.
- Demo mode works the same way, since it's all server-side.

## Done when

- [ ] "More actions → Write description with Descripta" on any product writes and applies a draft without leaving the page.
- [ ] The block shows the same health score as the app's products table.
- [ ] The action appears in History like any other draft.
